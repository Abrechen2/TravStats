/**
 * A friend on this server (spec 2026-11-08 §11.3): ONE `local_connections` row per unordered pair,
 * `user_low_id < user_high_id`. Everything a pair can do to each other is a transition of that one
 * row, taken under the pair lock and conditional on the state it was read in — so a crossed
 * request (both ask), a revoke racing an accept and a stale accept cannot leave two rows that
 * disagree.
 *
 *   request ──► pending ──accept──► active ──revoke──► revoked ──request──► pending …
 *                  │  └─decline──► declined ──(30 days, then)──request──► pending
 *                  └─ the other asks too (crossed) ──► active
 *
 * Each side's switches are what THAT user gives. A switch update changes the caller's side only.
 * The legacy rows the rest of the code still reads follow the connection: `share_consents`
 * (propagation of linked copies) and the stored comparison scope (`scopeStore.ts`).
 */
import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import type { LocalConnection } from "../../prisma";
import { connectionSwitchesSchema, type ConnectionSwitches } from "../../schemas/tripSharePeer";
import { lockPair } from "../comparison/consents";
import { detachAfterWithdrawal } from "../sharing/detach";
import { ALL_OFF } from "../sharing/federation/connections/switches";
import { applyLeaderboardSwitch, defaultScope } from "./scopeStore";
import { friendsError } from "./errors";

export type LocalState = "pending" | "active" | "declined" | "revoked";

/** A new connection's switches default ON (owner 2026-11-08, §11.2.3). */
export const DEFAULT_ON: ConnectionSwitches = {
  plans: true,
  stats: "full",
  achievements: true,
  leaderboard: true,
  tripOffers: true,
};

/** A declined asker is not heard again for this long (as for a connection across servers). */
export const DECLINE_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;

/** The unordered pair in the table's order (byte order, as the CHECK has it). */
export const orderPair = (a: string, b: string): { low: string; high: string } =>
  a < b ? { low: a, high: b } : { low: b, high: a };

type Db = Pick<DbTransaction, "localConnection">;

export const findLocal = (db: Db, a: string, b: string): Promise<LocalConnection | null> => {
  const { low, high } = orderPair(a, b);
  return db.localConnection.findUnique({
    where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
  });
};

/** What `parse` fails on reads as all off: a damaged switch set grants nothing. */
export const switchesFrom = (raw: unknown): ConnectionSwitches => {
  const parsed = connectionSwitchesSchema.safeParse(raw);
  return parsed.success ? parsed.data : ALL_OFF;
};

/** The switches `userId` gives in `row`, and the ones `userId` receives. */
export function sidesOf(
  row: Pick<LocalConnection, "userLowId" | "lowSwitches" | "highSwitches">,
  userId: string
): { mine: ConnectionSwitches; theirs: ConnectionSwitches } {
  const lowIsMe = row.userLowId === userId;
  return {
    mine: switchesFrom(lowIsMe ? row.lowSwitches : row.highSwitches),
    theirs: switchesFrom(lowIsMe ? row.highSwitches : row.lowSwitches),
  };
}

export const otherOf = (row: Pick<LocalConnection, "userLowId" | "userHighId">, userId: string) =>
  row.userLowId === userId ? row.userHighId : row.userLowId;

/** The columns that hold `userId`'s side. */
const sideColumn = (row: Pick<LocalConnection, "userLowId">, userId: string) =>
  row.userLowId === userId ? ("lowSwitches" as const) : ("highSwitches" as const);

const json = (s: ConnectionSwitches): Prisma.InputJsonValue =>
  s as unknown as Prisma.InputJsonValue;

const stateConflict = (userId: string, otherId: string) =>
  friendsError(
    "FRIENDS_CONNECTION_STATE",
    409,
    "The connection is not in a state this can be done in",
    {
      userId,
      otherId,
    }
  );

/** The comparison storage follows each side's leaderboard switch. */
async function followLeaderboard(
  tx: DbTransaction,
  row: Pick<LocalConnection, "userLowId" | "userHighId">,
  sides: { low: ConnectionSwitches; high: ConnectionSwitches; active: boolean },
  fallbacks: {
    low: Awaited<ReturnType<typeof defaultScope>>;
    high: Awaited<ReturnType<typeof defaultScope>>;
  }
): Promise<void> {
  await applyLeaderboardSwitch(
    tx,
    row.userLowId,
    { viewerId: row.userHighId },
    sides.active && sides.low.leaderboard,
    fallbacks.low
  );
  await applyLeaderboardSwitch(
    tx,
    row.userHighId,
    { viewerId: row.userLowId },
    sides.active && sides.high.leaderboard,
    fallbacks.high
  );
}

/**
 * Linked copies travel over `share_consents` (who receives whose changes). An active connection
 * writes a yes in both directions — WHO may offer a trip is the switch, checked in `authz.ts`,
 * not this row — exactly as a connection across servers does (`activate.ts`).
 */
async function writeShareConsents(tx: DbTransaction, a: string, b: string): Promise<void> {
  const now = new Date();
  for (const [requesterId, targetId] of [
    [a, b],
    [b, a],
  ] as const)
    await tx.shareConsent.upsert({
      where: { requesterId_targetId: { requesterId, targetId } },
      create: { requesterId, targetId, status: "accepted", decidedAt: now },
      update: { status: "accepted", decidedAt: now },
    });
}

async function activate(tx: DbTransaction, row: LocalConnection): Promise<void> {
  await writeShareConsents(tx, row.userLowId, row.userHighId);
  await followLeaderboard(
    tx,
    row,
    { low: switchesFrom(row.lowSwitches), high: switchesFrom(row.highSwitches), active: true },
    { low: await defaultScope(row.userLowId), high: await defaultScope(row.userHighId) }
  );
}

/**
 * `askerId` asks `targetId`, with the switches they give. Returns what happened so the caller can
 * answer without saying whether a request was dropped:
 *  - `pending`: a new request, or one reopened after a revoke or a decline long enough ago;
 *  - `active`: the other side had asked first — the second ask accepts (crossed requests);
 *  - `dropped`: the target declined this asker less than 30 days ago (nothing changes, nobody is told).
 * An open request or a live connection is a named 409.
 */
export async function requestLocal(
  askerId: string,
  targetId: string,
  switches: ConnectionSwitches
): Promise<"pending" | "active" | "dropped"> {
  const { low, high } = orderPair(askerId, targetId);
  const askerIsLow = askerId === low;
  const mineFirst = { [askerIsLow ? "lowSwitches" : "highSwitches"]: json(switches) };
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, askerId, targetId);
    const row = await findLocal(tx, askerId, targetId);
    const now = new Date();
    if (!row) {
      await tx.localConnection.create({
        data: {
          userLowId: low,
          userHighId: high,
          state: "pending",
          requestedBy: askerId,
          requestedAt: now,
          ...mineFirst,
        },
      });
      return "pending";
    }
    if (row.state === "active" || (row.state === "pending" && row.requestedBy === askerId))
      throw friendsError(
        "FRIENDS_CONNECTION_EXISTS",
        409,
        "There is a connection with that person",
        {
          userId: askerId,
          otherId: targetId,
        }
      );
    if (row.state === "pending") {
      // Crossed: the other side asked first, so this ask is the answer.
      const changed = await tx.localConnection.updateMany({
        where: { id: row.id, state: "pending", requestedBy: targetId },
        data: { ...mineFirst, state: "active", confirmedAt: now, endedAt: null, endedBy: null },
      });
      if (changed.count !== 1) throw stateConflict(askerId, targetId);
      await activate(tx, await tx.localConnection.findUniqueOrThrow({ where: { id: row.id } }));
      return "active";
    }
    if (
      row.state === "declined" &&
      row.endedBy === targetId &&
      row.endedAt &&
      now.getTime() - row.endedAt.getTime() < DECLINE_BLOCK_MS
    )
      return "dropped";
    // Declined (long ago, or by the asker) or revoked: reopened as a fresh request.
    await tx.localConnection.update({
      where: { id: row.id },
      data: {
        ...mineFirst,
        [askerIsLow ? "highSwitches" : "lowSwitches"]: json(ALL_OFF),
        state: "pending",
        requestedBy: askerId,
        requestedAt: now,
        confirmedAt: null,
        endedAt: null,
        endedBy: null,
      },
    });
    return "pending";
  });
}

/** Confirm a request with the switches the answering side chose. A stale accept is a 409. */
export async function acceptLocal(
  userId: string,
  otherId: string,
  switches: ConnectionSwitches
): Promise<LocalConnection> {
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, otherId);
    const row = await findLocal(tx, userId, otherId);
    if (!row) throw friendsError("FRIENDS_NOT_FOUND", 404, "No such request", { userId, otherId });
    const changed = await tx.localConnection.updateMany({
      where: { id: row.id, state: "pending", requestedBy: otherId },
      data: {
        [sideColumn(row, userId)]: json(switches),
        state: "active",
        confirmedAt: new Date(),
        endedAt: null,
        endedBy: null,
      },
    });
    if (changed.count !== 1) throw stateConflict(userId, otherId);
    const active = await tx.localConnection.findUniqueOrThrow({ where: { id: row.id } });
    await activate(tx, active);
    return active;
  });
}

/** Decline a request that was made to `userId`. */
export async function declineLocal(userId: string, otherId: string): Promise<LocalConnection> {
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, otherId);
    const row = await findLocal(tx, userId, otherId);
    if (!row) throw friendsError("FRIENDS_NOT_FOUND", 404, "No such request", { userId, otherId });
    const changed = await tx.localConnection.updateMany({
      where: { id: row.id, state: "pending", requestedBy: otherId },
      data: { state: "declined", endedAt: new Date(), endedBy: userId },
    });
    if (changed.count !== 1) throw stateConflict(userId, otherId);
    return tx.localConnection.findUniqueOrThrow({ where: { id: row.id } });
  });
}

/**
 * End a connection, or take back a request not yet answered. Everything shown through it stops at
 * once: every switch off, the comparison consents withdrawn (their scope kept), the share consents
 * withdrawn. Linked copies already delivered become independent trips and stay open; plans already
 * joined stay readable (`authz.ts`), as they do across servers.
 */
export async function revokeLocal(userId: string, otherId: string): Promise<LocalConnection> {
  return prisma.$transaction(
    async (tx) => {
      await lockPair(tx, userId, otherId);
      const row = await findLocal(tx, userId, otherId);
      if (!row) throw friendsError("FRIENDS_NOT_FOUND", 404, "No such friend", { userId, otherId });
      const now = new Date();
      const changed = await tx.localConnection.updateMany({
        where: { id: row.id, state: { in: ["active", "pending"] } },
        data: {
          state: "revoked",
          endedAt: now,
          endedBy: userId,
          lowSwitches: json(ALL_OFF),
          highSwitches: json(ALL_OFF),
        },
      });
      if (changed.count !== 1) throw stateConflict(userId, otherId);
      // Switching off never creates a row, so the fallback scope is never used here.
      const unused = await defaultScope(userId);
      await followLeaderboard(
        tx,
        row,
        { low: ALL_OFF, high: ALL_OFF, active: false },
        { low: unused, high: unused }
      );
      await tx.shareConsent.updateMany({
        where: {
          status: { in: ["pending", "accepted"] },
          OR: [
            { requesterId: userId, targetId: otherId },
            { requesterId: otherId, targetId: userId },
          ],
        },
        data: { status: "withdrawn", decidedAt: now },
      });
      await detachAfterWithdrawal(tx, userId, otherId);
      await detachAfterWithdrawal(tx, otherId, userId);
      return tx.localConnection.findUniqueOrThrow({ where: { id: row.id } });
    },
    { timeout: 30_000 }
  );
}

/** Change what `userId` gives. Only an active connection has switches to change. */
export async function setLocalSwitches(
  userId: string,
  otherId: string,
  switches: ConnectionSwitches
): Promise<LocalConnection> {
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, otherId);
    const row = await findLocal(tx, userId, otherId);
    if (!row) throw friendsError("FRIENDS_NOT_FOUND", 404, "No such friend", { userId, otherId });
    const changed = await tx.localConnection.updateMany({
      where: { id: row.id, state: "active" },
      data: { [sideColumn(row, userId)]: json(switches) },
    });
    if (changed.count !== 1) throw stateConflict(userId, otherId);
    const next = await tx.localConnection.findUniqueOrThrow({ where: { id: row.id } });
    await followLeaderboard(
      tx,
      next,
      { low: switchesFrom(next.lowSwitches), high: switchesFrom(next.highSwitches), active: true },
      { low: await defaultScope(next.userLowId), high: await defaultScope(next.userHighId) }
    );
    return next;
  });
}

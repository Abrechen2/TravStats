/**
 * The receiving side of the connection messages (spec 2026-11-02 §3). The route has authenticated
 * the peer; everything in a body is that server's word.
 *
 * Every message is answered `{received:true}` — an unknown or deactivated user, one who is not
 * findable, a person who declined, a spent budget, a stale generation and a taken request all read
 * the same, so the answer enumerates nothing. Each message is idempotent: it applies only when its
 * `generation` is newer than the last accepted from that side (`peer_generation`), so a repeat or
 * an overtaken message changes nothing. A refusal is logged, never sent.
 */
import { randomUUID } from "crypto";
import { prisma, type DbTransaction } from "../../../../db";
import { Prisma } from "../../../../prisma";
import logger from "../../../../utils/logger";
import { loadIdentity } from "../../../federation/identity";
import { PERSON_SELECT } from "../../people";
import type {
  ConnectAccept,
  ConnectDecline,
  ConnectRequest,
  ConnectRevoke,
  ConnectSettings,
} from "../../../../schemas/tripSharePeer";
import { DIRECTORY_PAIRING_LIMIT, takeDirectoryLookup } from "../directory";
import { revokePairing } from "../lifecycle";
import { activateConnection, applyLeaderboardSwitch, reconcileLeaderboard } from "./activate";

export const RECEIVED = { received: true } as const;
/** A declined request blocks the same person's next requests for this long. */
export const DECLINE_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;

type Account = Prisma.RemoteShareAccountGetPayload<object>;

/** Run `apply`; whatever happens the answer is the same, and a failure is only logged. */
async function quietly(
  operation: string,
  origin: string,
  apply: () => Promise<unknown>
): Promise<typeof RECEIVED> {
  try {
    await apply();
  } catch (err) {
    // A racing duplicate loses on the unique index; either way the answer does not change.
    const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    logger[raced ? "info" : "warn"]({ operation, origin, err }, "A connection message was dropped");
  }
  return RECEIVED;
}

/**
 * The row a message addresses: `to` is this server's channel, `from` the sender's own. Two cases
 * have one side unknown: a sender whose request is still waiting holds a placeholder for `to`
 * (a cancelled request is found by the sender's channel, on a row that is still `pending_in`), and
 * the asker of a request holds a placeholder for `from` until it is answered.
 */
async function addressed(tx: DbTransaction, origin: string, from: string, to: string) {
  const row = await tx.remoteShareAccount.findUnique({
    where: { origin_localChannel: { origin, localChannel: to } },
  });
  if (row && (row.state === "pending_out" || row.channel === from)) return row;
  const asked = await tx.remoteShareAccount.findUnique({
    where: { origin_channel: { origin, channel: from } },
  });
  return asked?.state === "pending_in" ? asked : null;
}

const fresh = (row: Account, generation: number) => generation > row.peerGeneration;

// ------------------------------------------------------------------------------ connect-request

/**
 * Two people asking each other at once: the server with the greater origin gives way — its own
 * request becomes the incoming one to answer — so exactly one request survives on both sides.
 */
const givesWay = (local: string, sender: string): boolean => local > sender;

function incoming(body: ConnectRequest) {
  return {
    state: "pending_in",
    channel: body.channel,
    username: body.fromUsername,
    displayName: body.fromDisplayName,
    remoteSwitches: body.switches,
    peerGeneration: body.generation,
    peerLeaderboardChannel: body.leaderboardChannel,
    requestedAt: new Date(),
    confirmedAt: null,
    endedAt: null,
    endedByMe: false,
  } satisfies Prisma.RemoteShareAccountUncheckedUpdateInput;
}

async function applyRequest(origin: string, body: ConnectRequest, localOrigin: string) {
  if (!takeDirectoryLookup(origin)) return;
  await prisma.$transaction(async (tx) => {
    const byChannel = await tx.remoteShareAccount.findUnique({
      where: { origin_channel: { origin, channel: body.channel } },
      include: { user: { select: { ...PERSON_SELECT, isActive: true, federationFindable: true } } },
    });
    // A pairing that exists is the person's own; otherwise the name must be an active, findable user.
    const user =
      byChannel?.user ??
      (await tx.user.findUnique({
        where: { username: body.toUsername },
        select: { ...PERSON_SELECT, isActive: true, federationFindable: true },
      }));
    if (!user?.isActive) return;
    if (byChannel && byChannel.user.username !== body.toUsername) return;
    // Findable means "may receive requests" from strangers; a person who already holds a connection
    // with us (one from before connections, or one sent back to reconfirm) keeps being able to ask.
    if (!user.federationFindable && !["reconfirm", "active"].includes(byChannel?.state ?? ""))
      return;
    const existing = byChannel as Account | null;
    if (existing) {
      if (!fresh(existing, body.generation)) return;
      // An active connection asked again (the other side restored a backup and confirms anew): it
      // waits for this person's answer, and nothing new starts on it meanwhile.
      if (existing.state === "declined" && declinedRecently(existing)) return;
      if (existing.state === "pending_out" && !givesWay(localOrigin, origin)) return;
      await tx.remoteShareAccount.updateMany({
        where: { id: existing.id, state: existing.state, peerGeneration: existing.peerGeneration },
        data: incoming(body),
      });
      return;
    }
    // Asking again with a fresh channel does not lift a decline, and a crossing request meets the
    // one this person's server already holds.
    const sameName = await tx.remoteShareAccount.findMany({
      where: { userId: user.id, origin, username: body.fromUsername },
    });
    if (sameName.some(declinedRecently)) return;
    const crossing = sameName.find((r) => r.state === "pending_out");
    if (crossing) {
      if (!givesWay(localOrigin, origin)) return;
      await tx.remoteShareAccount.update({ where: { id: crossing.id }, data: incoming(body) });
      return;
    }
    if (sameName.some((r) => r.state === "active" || r.state === "pending_in")) return;
    // An ended connection with this person (whose channel was never learned, or changed) is asked
    // again on its own row, so one person is one row.
    const ended = sameName.find((r) => r.state === "declined" || r.state === "revoked");
    if (ended) {
      await tx.remoteShareAccount.update({ where: { id: ended.id }, data: incoming(body) });
      return;
    }
    if (
      (await tx.remoteShareAccount.count({ where: { userId: user.id } })) >= DIRECTORY_PAIRING_LIMIT
    )
      return;
    await tx.remoteShareAccount.create({
      data: {
        userId: user.id,
        origin,
        localChannel: randomUUID(),
        ...incoming(body),
      },
    });
  });
}

const declinedRecently = (row: Account): boolean =>
  row.state === "declined" &&
  row.endedByMe &&
  !!row.endedAt &&
  Date.now() - row.endedAt.getTime() < DECLINE_BLOCK_MS;

export async function serveConnectRequest(
  origin: string,
  body: ConnectRequest,
  localOrigin?: string
) {
  const local = localOrigin ?? (await loadIdentity()).origin;
  return quietly("connect_request", origin, () => applyRequest(origin, body, local));
}

// -------------------------------------------------------------------------------- connect-accept

export async function serveConnectAccept(origin: string, body: ConnectAccept) {
  let leaderboard: { userId: string; id: string; on: boolean } | null = null;
  const answer = await quietly("connect_accept", origin, async () => {
    leaderboard = await prisma.$transaction(async (tx) => {
      const row = await addressed(tx, origin, body.from, body.to);
      if (!row || row.state !== "pending_out" || !fresh(row, body.generation)) return null;
      const taken = await tx.remoteShareAccount.findUnique({
        where: { origin_channel: { origin, channel: body.from } },
        select: { id: true },
      });
      if (taken && taken.id !== row.id) return null;
      // Conditional on what was read: a concurrent answer or revoke wins, this one changes nothing.
      const claimed = await tx.remoteShareAccount.updateMany({
        where: { id: row.id, state: "pending_out", peerGeneration: row.peerGeneration },
        data: {
          state: "active",
          channel: body.from,
          username: body.username,
          displayName: body.displayName,
          remoteSwitches: body.switches,
          peerGeneration: body.generation,
          confirmedAt: new Date(),
          endedAt: null,
          endedByMe: false,
        },
      });
      if (claimed.count !== 1) return null;
      const active = await tx.remoteShareAccount.findUniqueOrThrow({ where: { id: row.id } });
      const linked = await activateConnection(tx, active, body.leaderboardChannel);
      const agreed = await reconcileLeaderboard(tx, active, linked, body.leaderboardChannel);
      return { userId: active.userId, id: active.id, on: active.shareLeaderboard && agreed };
    });
    if (leaderboard?.on) await applyLeaderboardSwitch(leaderboard.userId, leaderboard.id, true);
  });
  return answer;
}

// ------------------------------------------------------------ connect-decline / -revoke / -settings

export const serveConnectDecline = (origin: string, body: ConnectDecline) =>
  quietly("connect_decline", origin, () =>
    prisma.$transaction(async (tx) => {
      const row = await addressed(tx, origin, body.from, body.to);
      if (!row || row.state !== "pending_out" || !fresh(row, body.generation)) return;
      await tx.remoteShareAccount.updateMany({
        where: { id: row.id, state: "pending_out", peerGeneration: row.peerGeneration },
        data: {
          state: "declined",
          peerGeneration: body.generation,
          endedAt: new Date(),
          endedByMe: false,
        },
      });
    })
  );

/** The other side ended it (or withdrew its request): everything shown through it ends here. */
export const serveConnectRevoke = (origin: string, body: ConnectRevoke) =>
  quietly("connect_revoke", origin, () =>
    prisma.$transaction(
      async (tx) => {
        const row = await addressed(tx, origin, body.from, body.to);
        if (!row || !fresh(row, body.generation)) return;
        if (!["pending_in", "pending_out", "active", "reconfirm"].includes(row.state)) return;
        // Claim the generation first: a concurrent message on the same row waits for this one.
        const claimed = await tx.remoteShareAccount.updateMany({
          where: { id: row.id, state: row.state, peerGeneration: row.peerGeneration },
          data: { peerGeneration: body.generation, endedByMe: false },
        });
        if (claimed.count !== 1) return;
        await revokePairing(tx, row, false, true);
      },
      { timeout: 30_000 }
    )
  );

export const serveConnectSettings = (origin: string, body: ConnectSettings) =>
  quietly("connect_settings", origin, () =>
    prisma.$transaction(async (tx) => {
      const row = await addressed(tx, origin, body.from, body.to);
      if (!row || row.state !== "active" || !fresh(row, body.generation)) return;
      await tx.remoteShareAccount.updateMany({
        where: { id: row.id, state: "active", peerGeneration: row.peerGeneration },
        data: { remoteSwitches: body.switches, peerGeneration: body.generation },
      });
    })
  );

/**
 * Who may do what to whom between two accounts on this server (spec 2026-11-08 §11.7). A pair
 * that has a `local_connections` row is judged by that connection's switches ONLY; a pair without
 * one keeps the old `share_consents` rule, so nothing breaks for accounts that never connected.
 * A connection that is revoked, declined or pending grants nothing new — but what was delivered
 * keeps working: linked copies are independent trips once the consents are withdrawn, and a plan
 * a person already joined stays readable (`mayWorkOnPlan`).
 */
import type { DbTransaction } from "../../db";
import { prisma } from "../../db";
import { hasAcceptedConsent } from "../sharing/consent";
import type { ConsentStatus } from "../../schemas/sharing";
import { findLocal, otherOf, sidesOf } from "./localConnections";

type Db = Pick<DbTransaction, "shareConsent" | "localConnection">;

/** What `giverId` gives `otherId` in the connection of the pair, or null when they have none. */
async function givenBy(db: Db, giverId: string, otherId: string) {
  const row = await findLocal(db, giverId, otherId);
  if (!row) return null;
  return { active: row.state === "active", switches: sidesOf(row, giverId).mine };
}

/**
 * May `requesterId` offer a trip to `targetId` — the target lets them (their `tripOffers` switch
 * on, connection active)? Asked again on every share: a switch turned off ends it at once.
 */
export async function mayOfferTripTo(
  db: Db,
  requesterId: string,
  targetId: string
): Promise<boolean> {
  const given = await givenBy(db, targetId, requesterId);
  if (!given) return hasAcceptedConsent(db, requesterId, targetId);
  return given.active && given.switches.tripOffers;
}

/** Has `userId` switched plans on for `otherId` (a connection, active)? Without a connection: the old consent. */
/** Pair-level revoke through the old consent controls must reach the connection too. */
export async function switchOffGiven(db: Db, giverId: string, otherId: string): Promise<void> {
  const row = await findLocal(db, giverId, otherId);
  if (!row || row.state !== "active") return;
  const { mine } = sidesOf(row, giverId);
  const col = row.userLowId === giverId ? "lowSwitches" : "highSwitches";
  await db.localConnection.update({
    where: { id: row.id },
    data: { [col]: { ...mine, tripOffers: false, plans: false } },
  });
}

export async function plansGivenTo(db: Db, userId: string, otherId: string): Promise<boolean> {
  const given = await givenBy(db, userId, otherId);
  if (!given) return hasAcceptedConsent(db, otherId, userId);
  return given.active && given.switches.plans;
}

/**
 * Whether a plan's local member may still work on it. With a connection, joining was the gate:
 * ending the friendship or switching plans off stops NEW invitations only, a plan already joined
 * stays open (§11.7, as across servers). Without a connection the old rule stands: withdrawing
 * the consent from either side ends the access at once.
 */
export async function mayWorkOnPlan(db: Db, ownerId: string, memberId: string): Promise<boolean> {
  const row = await findLocal(db, ownerId, memberId);
  if (row?.state === "active") {
    const { mine, theirs } = sidesOf(row, ownerId);
    if (mine.plans && theirs.plans) return true;
  }
  // Removed friend: a plan already joined stays open (revokeLocal ends the memberships that were
  // never granted through plans). A pending or declined row grants nothing; it, and an active row
  // with plans off, fall through to the old consent rule.
  if (row?.state === "revoked") return true;
  const [toThem, toMe] = await Promise.all([
    hasAcceptedConsent(db, ownerId, memberId),
    hasAcceptedConsent(db, memberId, ownerId),
  ]);
  return toThem && toMe;
}

/**
 * The caller's standing towards each person they may offer trips to, as a consent status: for a
 * pair with a connection what its switch says ("accepted": they let the caller offer), for any
 * other pair the old consent row. The one list the trip page and the companion link read.
 */
export async function offerStatuses(userId: string): Promise<Map<string, ConsentStatus>> {
  const [legacy, connections] = await Promise.all([
    prisma.shareConsent.findMany({
      // Local pairs only: remote people join a trip through the offer, not this list.
      where: { requesterId: userId, targetId: { not: null } },
      select: { targetId: true, status: true },
    }),
    prisma.localConnection.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
    }),
  ]);
  const out = new Map<string, ConsentStatus>(
    legacy.map((c) => [c.targetId as string, c.status as ConsentStatus])
  );
  for (const row of connections) {
    const other = otherOf(row, userId);
    const theirs = sidesOf(row, userId).theirs;
    const status: ConsentStatus =
      row.state === "active"
        ? theirs.tripOffers
          ? "accepted"
          : "withdrawn"
        : row.state === "pending"
          ? "pending"
          : "withdrawn";
    out.set(other, status);
  }
  return out;
}

/**
 * The local owners whose numbers `viewerId` may read, among `ownerIds`: a pair with a connection
 * needs it active with the leaderboard switch on BOTH sides (the figures flow only while the
 * viewer shares back, spec 2026-11-07 §9.1); a pair without one keeps the old consent rule, which
 * the caller has already applied. Returns the owners the connection REFUSES, so a caller removes
 * exactly those and leaves unconnected pairs alone.
 */
export async function ownersRefusedByConnection(
  db: Db,
  viewerId: string,
  ownerIds: readonly string[]
): Promise<Set<string>> {
  if (ownerIds.length === 0) return new Set();
  const rows = await db.localConnection.findMany({
    where: {
      OR: [
        { userLowId: viewerId, userHighId: { in: [...ownerIds] } },
        { userHighId: viewerId, userLowId: { in: [...ownerIds] } },
      ],
    },
  });
  const refused = new Set<string>();
  for (const row of rows) {
    const { mine, theirs } = sidesOf(row, viewerId);
    if (!(row.state === "active" && mine.leaderboard && theirs.leaderboard))
      refused.add(otherOf(row, viewerId));
  }
  return refused;
}

/** The ids of everyone `userId` has a connection row with, whatever its state. */
export async function connectedUserIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.localConnection.findMany({
    where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
    select: { userLowId: true, userHighId: true },
  });
  return new Set(rows.map((r) => otherOf(r, userId)));
}

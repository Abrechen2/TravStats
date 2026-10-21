/**
 * The roster of a trip shared across servers (spec 2026-10-20 §4 `roster`, F5, phase F-S4e).
 *
 * The home knows everyone; a spoke knows only its own pairing with the home. So the home tells
 * each spoke member who is on the trip — this server's members and the people on other servers —
 * whenever that changes, and names every person by a `ref` minted for this group: random for a
 * person on another server (`TripShareRemoteMember.rosterRef`), a hash of group ref and account
 * id for a member here (`userRef`). Neither ever names an account of either server.
 *
 * What it is for:
 * - **Names.** A change relayed by the home carries its author's ref; the spoke names the author
 *   from its roster, never from the name the message claims (`inbound.ts` `authorOf`).
 * - **Consent.** A newcomer's changes reach a member only after that member's yes (`mayReach`):
 *   the person's own pairing is a yes already (its consent), everyone else needs a roster consent
 *   (`TripShareRosterConsent`). Accepting an offer says yes to the roster the offer showed;
 *   anyone who joins later is asked. The rule holds on every server that holds a member's copy —
 *   at the home for its own members, on a spoke for its people — so it holds for relays too.
 *   Changes a member did not take while not asked are not replayed after a yes (as locally).
 */
import { createHash } from "crypto";
import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { loadIdentity } from "../../federation/identity";
import { QUEUEABLE, type MemberTrip } from "../members";
import { PERSON_SELECT, toPerson } from "../people";
import {
  MAX_ROSTER,
  type RosterEntry,
  type RosterMessage,
  type TripShareAck,
} from "../../../schemas/tripSharePeer";
import type { RosterConsentStatus } from "../../../schemas/sharingRemote";
import type { Prisma } from "../../../prisma";
import { requireTripFederation } from "./access";
import { kickDelivery } from "./deliveryKick";
import { remoteShareError } from "./errors";
import { addressed, requireReceiving } from "./peerMember";
import { serveOnce, takeSeq } from "./streams";

/** Remote members who are on the trip (the roster's people on other servers). */
export const ON_TRIP = ["active", "unreachable", "suspended"];

/** A member of the home's own server in this group's roster: uuid-shaped, never the account id. */
export function userRef(federatedRef: string, userId: string): string {
  const h = createHash("sha256").update(`travstats-roster|${federatedRef}|${userId}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Home: who is on the trip — this server's members first, then the people on other servers. */
export async function homeRoster(
  c: Pick<DbTransaction, "trip" | "tripShareRemoteMember">,
  group: { id: string; federatedRef: string },
  localOrigin: string
): Promise<RosterEntry[]> {
  const [trips, remotes] = await Promise.all([
    c.trip.findMany({
      where: { shareGroupId: group.id },
      select: { userId: true, user: { select: PERSON_SELECT } },
      orderBy: { createdAt: "asc" },
    }),
    c.tripShareRemoteMember.findMany({
      where: { groupId: group.id, state: { in: ON_TRIP } },
      select: { rosterRef: true, remote: { select: { displayName: true, origin: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const locals = new Map<string, RosterEntry>();
  for (const t of trips)
    if (!locals.has(t.userId))
      locals.set(t.userId, {
        ref: userRef(group.federatedRef, t.userId),
        displayName: toPerson(t.user).displayName,
        origin: localOrigin,
      });
  return [
    ...locals.values(),
    ...remotes.map((r) => ({
      ref: r.rosterRef,
      displayName: r.remote.displayName,
      origin: r.remote.origin,
    })),
  ].slice(0, MAX_ROSTER);
}

/**
 * Home: the roster changed (someone joined or left) — queue it for every spoke member whose
 * messages queue, inside the caller's transaction. A spoke's own group has nothing to tell.
 */
export async function queueRoster(tx: DbTransaction, groupId: string): Promise<number> {
  const group = await tx.tripShareGroup.findUnique({ where: { id: groupId } });
  if (!group?.federatedRef || group.homeOrigin) return 0;
  const identity = await loadIdentity().catch(() => null);
  if (!identity) return 0;
  const federated = { id: group.id, federatedRef: group.federatedRef };
  const members = await homeRoster(tx, federated, identity.origin);
  const targets = await tx.tripShareRemoteMember.findMany({
    where: { groupId, ...QUEUEABLE },
    include: { remote: true },
  });
  for (const t of targets)
    await tx.tripShareOutbox.create({
      data: {
        groupId,
        memberId: t.id,
        peerOrigin: t.remote.origin,
        kind: "roster",
        payload: {
          from: t.remote.localChannel,
          to: t.remote.channel,
          self: userRef(group.federatedRef, t.remote.userId),
          you: t.rosterRef,
          members,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  if (targets.length > 0) kickDelivery();
  return targets.length;
}

/**
 * Spoke: keep the roster as the home sent it — everyone named is present, anyone no longer named
 * stays with their name but `present` false — and the two refs of this pairing.
 */
export async function storeRoster(
  tx: DbTransaction,
  groupId: string,
  memberId: string,
  roster: { self: string; you: string; members: readonly RosterEntry[] }
): Promise<void> {
  await tx.tripShareRemoteMember.update({
    where: { id: memberId },
    data: { rosterRef: roster.self, localRef: roster.you },
  });
  await tx.tripShareRosterEntry.updateMany({
    where: { groupId, ref: { notIn: roster.members.map((m) => m.ref) } },
    data: { present: false },
  });
  for (const m of roster.members)
    await tx.tripShareRosterEntry.upsert({
      where: { groupId_ref: { groupId, ref: m.ref } },
      create: { groupId, ref: m.ref, displayName: m.displayName, origin: m.origin },
      update: { displayName: m.displayName, origin: m.origin, present: true },
    });
}

/** A roster arrives from the group's home. */
export const serveRoster = (origin: string, message: RosterMessage): Promise<TripShareAck> =>
  serveOnce(origin, message, async (tx) => {
    const { group, member } = await addressed(tx, origin, message, "theirs");
    const live = requireReceiving(member);
    await takeSeq(tx, group.id, origin, message.seq);
    await storeRoster(tx, group.id, live.id, message);
  });

/** Say yes to everyone an accepted offer named (spoke, inside the accept's transaction). */
export async function acceptOfferedRoster(
  tx: DbTransaction,
  groupId: string,
  userId: string,
  refs: readonly string[]
): Promise<void> {
  for (const ref of new Set(refs))
    await tx.tripShareRosterConsent.upsert({
      where: { groupId_userId_ref: { groupId, userId, ref } },
      create: { groupId, userId, ref, status: "accepted" },
      update: { status: "accepted", decidedAt: new Date() },
    });
}

/** A remote author as the gate reads them: their pairing here, if any, and their roster ref. */
export interface GateAuthor {
  pairingId: string | null;
  ref?: string | null;
}

/**
 * Whether a change by a person on another server may reach `userId`'s copy: through the member's
 * own pairing with them (its consent was asked when it was made), or by the member's yes to them
 * on the roster. An author without a ref here is nobody the member could have said yes to.
 */
export async function mayReach(
  c: Pick<DbTransaction, "remoteShareAccount" | "tripShareRosterConsent">,
  groupId: string,
  userId: string,
  author: GateAuthor
): Promise<boolean> {
  if (author.pairingId) {
    const pairing = await c.remoteShareAccount.findUnique({
      where: { id: author.pairingId },
      select: { userId: true },
    });
    if (pairing?.userId === userId) return true;
  }
  if (!author.ref) return false;
  const row = await c.tripShareRosterConsent.findUnique({
    where: { groupId_userId_ref: { groupId, userId, ref: author.ref } },
  });
  return row?.status === "accepted";
}

/** The members among `members` whose copy a remote author's change may reach. */
export async function reachableBy(
  c: Pick<DbTransaction, "remoteShareAccount" | "tripShareRosterConsent">,
  groupId: string,
  members: readonly MemberTrip[],
  author: GateAuthor
): Promise<MemberTrip[]> {
  const out: MemberTrip[] = [];
  for (const m of members) if (await mayReach(c, groupId, m.userId, author)) out.push(m);
  return out;
}

/** How a person on the roster stands to the caller. */
export type RosterRelation = "you" | "paired" | "here" | RosterConsentStatus | "pending";

export interface RosterPersonView {
  ref: string;
  displayName: string;
  origin: string;
  relation: RosterRelation;
}

/**
 * The people on other servers on the caller's trip, each with whether their changes reach the
 * caller (`paired`, `accepted`) or not yet (`pending`, `declined`). At the home, the remote
 * members on the trip; on a spoke, the roster the home sent (the caller and this server's own
 * people are named but need no answer: `you`, `here`).
 */
export async function rosterView(
  userId: string,
  group: { id: string; homeOrigin: string | null },
  localOrigin: string
): Promise<RosterPersonView[]> {
  const consents = await prisma.tripShareRosterConsent.findMany({
    where: { groupId: group.id, userId },
  });
  const decided = new Map(consents.map((c) => [c.ref, c.status as RosterConsentStatus]));
  const answer = (ref: string): RosterRelation => decided.get(ref) ?? "pending";
  if (!group.homeOrigin) {
    const rows = await prisma.tripShareRemoteMember.findMany({
      where: { groupId: group.id, state: { in: ON_TRIP } },
      include: { remote: { select: { userId: true, displayName: true, origin: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      ref: r.rosterRef,
      displayName: r.remote.displayName,
      origin: r.remote.origin,
      relation: r.remote.userId === userId ? "paired" : answer(r.rosterRef),
    }));
  }
  const [entries, mine] = await Promise.all([
    prisma.tripShareRosterEntry.findMany({
      where: { groupId: group.id, present: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tripShareRemoteMember.findMany({
      where: { groupId: group.id, remote: { userId } },
      select: { rosterRef: true, localRef: true },
    }),
  ]);
  const own = new Set(mine.flatMap((m) => (m.localRef ? [m.localRef] : [])));
  const paired = new Set(mine.map((m) => m.rosterRef));
  return entries.map((e) => ({
    ref: e.ref,
    displayName: e.displayName,
    origin: e.origin,
    relation: own.has(e.ref)
      ? "you"
      : paired.has(e.ref)
        ? "paired"
        : e.origin === localOrigin
          ? "here"
          : answer(e.ref),
  }));
}

/**
 * The caller says yes or no to a person on the roster of their trip. A yes lets that person's
 * changes reach the caller's copy from now on; it does not replay what came before.
 */
export async function decideRosterPerson(
  userId: string,
  tripId: string,
  ref: string,
  decision: RosterConsentStatus
): Promise<RosterPersonView[]> {
  const identity = await requireTripFederation(userId);
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");
  const group = trip.shareGroupId
    ? await prisma.tripShareGroup.findUnique({ where: { id: trip.shareGroupId } })
    : null;
  const view = group ? await rosterView(userId, group, identity.origin) : [];
  const person = view.find((p) => p.ref === ref);
  if (!group || !person || !["pending", "accepted", "declined"].includes(person.relation))
    throw remoteShareError("SHARE_REMOTE_ROSTER_NOT_FOUND", 404, "No such person on this trip", {
      userId,
    });
  await prisma.tripShareRosterConsent.upsert({
    where: { groupId_userId_ref: { groupId: group.id, userId, ref } },
    create: { groupId: group.id, userId, ref, status: decision },
    update: { status: decision, decidedAt: new Date() },
  });
  return rosterView(userId, group, identity.origin);
}

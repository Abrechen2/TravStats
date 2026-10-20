import type { DbTransaction } from "../../db";

/**
 * Who receives a member's changes.
 *
 * Owner decision 2026-10-16: membership alone is NOT consent. A member could
 * once share their copy on to a third account, which then wrote into every
 * other member's data although none of them had agreed to it. Now a write
 * reaches only members with an ACCEPTED consent with the writer (either
 * direction of the pair — `acceptedWith`), and `shareTrip` admits a newcomer
 * only with such a consent towards every current member.
 *
 * A withdrawn consent with no accepted one left still detaches the member
 * (`withdrawConsent` → `detach.ts`); this filter is the second line.
 */
export interface MemberTrip {
  id: string;
  userId: string;
}

/**
 * One side of a consent pair: an account on this server, or a person on another server
 * (`RemoteShareAccount`, spec 2026-10-20 F3). Both kinds live in one table, so this file stays
 * the one home of "who agreed with whom" — a second consent table would be a second rule.
 */
export type Party = { kind: "user"; id: string } | { kind: "remote"; id: string };

/** A party as a set key: ids of the two tables could otherwise meet in one `Set`. */
export const partyKey = (p: Party): string => `${p.kind}:${p.id}`;

type ConsentClient = Pick<DbTransaction, "shareConsent">;
interface PairRow {
  requesterId: string | null;
  targetId: string | null;
  remoteRequesterId: string | null;
  remoteTargetId: string | null;
  status: string;
}
const PAIR_SELECT = {
  requesterId: true,
  targetId: true,
  remoteRequesterId: true,
  remoteTargetId: true,
  status: true,
} as const;

const ids = (others: readonly Party[], kind: Party["kind"]) =>
  others.filter((o) => o.kind === kind).map((o) => o.id);

/**
 * Every row pairing `actor` with one of `others`, in either direction. A remote actor pairs only
 * with local users: two people on other servers never hold a consent here (CHECK
 * share_consents_party_check), so such a pair is not even asked for.
 */
async function pairRows(c: ConsentClient, actor: Party, others: readonly Party[], status?: string) {
  const users = ids(others, "user");
  const remotes = actor.kind === "user" ? ids(others, "remote") : [];
  if (users.length + remotes.length === 0) return [];
  const mine =
    actor.kind === "user"
      ? { as: { requesterId: actor.id }, to: { targetId: actor.id } }
      : { as: { remoteRequesterId: actor.id }, to: { remoteTargetId: actor.id } };
  const OR = [
    ...(users.length
      ? [
          { ...mine.as, targetId: { in: users } },
          { ...mine.to, requesterId: { in: users } },
        ]
      : []),
    ...(remotes.length
      ? [
          { ...mine.as, remoteTargetId: { in: remotes } },
          { ...mine.to, remoteRequesterId: { in: remotes } },
        ]
      : []),
  ];
  return c.shareConsent.findMany({
    where: { ...(status ? { status } : {}), OR },
    select: PAIR_SELECT,
  });
}

/** The side of `row` that is not `actor`. */
function otherSide(row: PairRow, actor: Party): string {
  const requester: Party = row.requesterId
    ? { kind: "user", id: row.requesterId }
    : { kind: "remote", id: row.remoteRequesterId ?? "" };
  const target: Party = row.targetId
    ? { kind: "user", id: row.targetId }
    : { kind: "remote", id: row.remoteTargetId ?? "" };
  return partyKey(partyKey(requester) === partyKey(actor) ? target : requester);
}

/** Party keys among `others` with an accepted consent with `actor`, in either direction. */
export async function acceptedParties(
  c: ConsentClient,
  actor: Party,
  others: readonly Party[]
): Promise<Set<string>> {
  const rows = await pairRows(c, actor, others, "accepted");
  return new Set(rows.map((r) => otherSide(r, actor)));
}

/** Party keys among `others` with a withdrawn consent towards `actor` and no accepted one. */
export async function withdrawnParties(
  c: ConsentClient,
  actor: Party,
  others: readonly Party[]
): Promise<Set<string>> {
  const rows = await pairRows(c, actor, others);
  const accepted = new Set(
    rows.filter((r) => r.status === "accepted").map((r) => otherSide(r, actor))
  );
  return new Set(
    rows
      .filter((r) => r.status === "withdrawn")
      .map((r) => otherSide(r, actor))
      .filter((key) => !accepted.has(key))
  );
}

const asUsers = (userIds: readonly string[]): Party[] =>
  userIds.map((id) => ({ kind: "user", id }));
const userIdsOf = (keys: Set<string>): Set<string> =>
  new Set([...keys].filter((k) => k.startsWith("user:")).map((k) => k.slice("user:".length)));

/** Users among `userIds` with a withdrawn consent towards `actorId` and no accepted one. */
export async function withdrawnTowards(
  c: ConsentClient,
  actorId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  return userIdsOf(await withdrawnParties(c, { kind: "user", id: actorId }, asUsers(userIds)));
}

/** Users among `userIds` with an accepted consent with `actorId`, in either direction. */
export async function acceptedWith(
  c: ConsentClient,
  actorId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  return userIdsOf(await acceptedParties(c, { kind: "user", id: actorId }, asUsers(userIds)));
}

/**
 * The other members' trips in `groupId` that may receive `actorId`'s changes.
 * A deactivated account receives nothing — no copy, no update, no notice —
 * while it is switched off; copy, update and removal notice all read this list.
 * What it misses is NOT replayed when the account is reactivated: the copies
 * stay as they were until the next change to the entry, or until the entry is
 * shared again (the rollout backfill does that for crossings).
 */
export async function receivingMembers(
  c: Pick<DbTransaction, "trip" | "shareConsent">,
  groupId: string,
  actorId: string
): Promise<MemberTrip[]> {
  const trips = await c.trip.findMany({
    where: { shareGroupId: groupId, NOT: { userId: actorId }, user: { isActive: true } },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const consenting = await acceptedWith(
    c,
    actorId,
    trips.map((t) => t.userId)
  );
  return trips.filter((t) => consenting.has(t.userId));
}

/**
 * Ids of the group's members (besides the sharer and the recipient) who have
 * NOT agreed to sharing with `recipientId` — the onward-share rule (owner,
 * 2026-10-16). Empty means the recipient may join. `shareTrip` refuses on a
 * non-empty answer and the trip page shows the same verdict, so both read it
 * from here.
 */
export async function missingGroupConsent(
  c: Pick<DbTransaction, "trip" | "shareConsent">,
  groupId: string,
  sharerId: string,
  recipientId: string
): Promise<string[]> {
  const memberTrips = await c.trip.findMany({
    where: { shareGroupId: groupId, userId: { notIn: [sharerId, recipientId] } },
    select: { userId: true },
  });
  const others = [...new Set(memberTrips.map((t) => t.userId))];
  const consenting = await acceptedWith(c, recipientId, others);
  return others.filter((id) => !consenting.has(id));
}

/** A person on another server who receives a member's changes, through that member's pairing. */
export interface RemoteMemberRef {
  /** The `TripShareRemoteMember` row. */
  id: string;
  remoteId: string;
  origin: string;
  /** How that server names the person in this pairing. */
  channel: string;
  /** How this server names the member towards that server. */
  localChannel: string;
}

const ACTIVE = { state: "active" } as const;
/**
 * A member whose server does not answer, or has the feature switched off there, or whose pin
 * this server's admin disabled, still gets their messages queued (F-S4d): they leave once the
 * server answers again, in order. A membership suspended by a restore, or one that ended, does not.
 */
export const QUEUEABLE = {
  OR: [
    { state: { in: ["active", "unreachable"] } },
    { state: "suspended", stateReason: { in: ["off", "peer-blocked"] } },
  ],
};

/**
 * The remote counterpart of `receivingMembers` (spec 2026-10-20 §5): the group's people on other
 * servers who may receive `actorId`'s changes — active members, reached through `actorId`'s own
 * pairing with them, with an accepted consent in either direction (`acceptedParties`, the same
 * rule as for local members). A pairing belongs to one local user, so a local member who never
 * paired with that person reaches them only through the home member who did (F5: a change that
 * reached that member here is relayed through their pairing), never by borrowing someone else's
 * consent. With `queueable`, members whose delivery is only held up count too (`QUEUEABLE`).
 */
export async function receivingRemotes(
  c: Pick<DbTransaction, "tripShareRemoteMember" | "shareConsent">,
  groupId: string,
  actorId: string,
  options: { queueable?: boolean } = {}
): Promise<RemoteMemberRef[]> {
  const rows = await c.tripShareRemoteMember.findMany({
    where: { groupId, remote: { userId: actorId }, ...(options.queueable ? QUEUEABLE : ACTIVE) },
    select: {
      id: true,
      remoteId: true,
      remote: { select: { origin: true, channel: true, localChannel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const consenting = await acceptedParties(
    c,
    { kind: "user", id: actorId },
    rows.map((r) => ({ kind: "remote", id: r.remoteId }))
  );
  return rows
    .filter((r) => consenting.has(partyKey({ kind: "remote", id: r.remoteId })))
    .map((r) => ({ id: r.id, remoteId: r.remoteId, ...r.remote }));
}

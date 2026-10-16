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

/** Users among `userIds` with a withdrawn consent towards `actorId` and no accepted one. */
export async function withdrawnTowards(
  c: Pick<DbTransaction, "shareConsent">,
  actorId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await c.shareConsent.findMany({
    where: {
      OR: [
        { requesterId: actorId, targetId: { in: [...userIds] } },
        { targetId: actorId, requesterId: { in: [...userIds] } },
      ],
    },
    select: { requesterId: true, targetId: true, status: true },
  });
  const other = (r: { requesterId: string; targetId: string }) =>
    r.requesterId === actorId ? r.targetId : r.requesterId;
  const accepted = new Set(rows.filter((r) => r.status === "accepted").map(other));
  return new Set(
    rows.filter((r) => r.status === "withdrawn" && !accepted.has(other(r))).map(other)
  );
}

/** Users among `userIds` with an accepted consent with `actorId`, in either direction. */
export async function acceptedWith(
  c: Pick<DbTransaction, "shareConsent">,
  actorId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await c.shareConsent.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: actorId, targetId: { in: [...userIds] } },
        { targetId: actorId, requesterId: { in: [...userIds] } },
      ],
    },
    select: { requesterId: true, targetId: true },
  });
  return new Set(rows.map((r) => (r.requesterId === actorId ? r.targetId : r.requesterId)));
}

/**
 * The other members' trips in `groupId` that may receive `actorId`'s changes.
 * A deactivated account receives nothing — no copy, no update, no notice —
 * while it is switched off; copy, update and removal notice all read this list.
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

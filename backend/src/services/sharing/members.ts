import type { DbTransaction } from "../../db";

/**
 * Who receives a member's changes.
 *
 * Membership of the group is the consent: a member joined because they had
 * accepted sharing from whoever brought them in, and two members brought in
 * by a third person have no consent row between them at all — decision 3
 * ("changes apply to everyone") still reaches them.
 *
 * What stops a member receiving changes is a consent that was WITHDRAWN
 * between the actor and them (in either direction) with no accepted one
 * left. `withdrawConsent` detaches such a member right away (`detach.ts`);
 * this filter is the second line, for any pair that slipped past it.
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

/** The other members' trips in `groupId` that may receive `actorId`'s changes. */
export async function receivingMembers(
  c: Pick<DbTransaction, "trip" | "shareConsent">,
  groupId: string,
  actorId: string
): Promise<MemberTrip[]> {
  const trips = await c.trip.findMany({
    where: { shareGroupId: groupId, NOT: { userId: actorId } },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const blocked = await withdrawnTowards(
    c,
    actorId,
    trips.map((t) => t.userId)
  );
  return trips.filter((t) => !blocked.has(t.userId));
}

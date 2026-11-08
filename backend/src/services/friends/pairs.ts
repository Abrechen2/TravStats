/**
 * What two friends hold together (spec 2026-11-08 §11.4): trips shared in either direction and
 * plans both are members of. Read-only; the data owner's switch decides what the PAGE shows
 * (§11.7), this answers what exists.
 */
import { prisma } from "../../db";
import type { z } from "../../schemas/zod";
import type { friendPlanSchema, friendTripSchema } from "../../schemas/friends";
import { friendsError } from "./errors";
import { resolveFriend } from "./resolve";

export type FriendTrip = z.infer<typeof friendTripSchema>;
export type FriendPlan = z.infer<typeof friendPlanSchema>;

const MEMBER_LIVE = ["active", "invited"];

export interface FriendTrips {
  toThem: FriendTrip[];
  fromThem: FriendTrip[];
}

const tripItem = (
  t: { id: string; name: string; startDate: Date | null; endDate: Date | null },
  copyState: FriendTrip["copyState"]
): FriendTrip => ({
  id: t.id,
  title: t.name,
  startDate: t.startDate?.toISOString() ?? null,
  endDate: t.endDate?.toISOString() ?? null,
  copyState,
  localTripId: t.id,
});

export async function friendTrips(userId: string, key: string): Promise<FriendTrips> {
  const target = await resolveFriend(userId, key);
  if (target.type === "comparison")
    throw friendsError("FRIENDS_NOT_FOUND", 404, "No trips with a comparison-only friend", {
      userId,
    });
  const out: FriendTrips = { toThem: [], fromThem: [] };
  if (target.type === "local") {
    const mine = await prisma.trip.findMany({
      where: {
        userId,
        shareGroupId: { not: null },
        shareGroup: { trips: { some: { userId: target.otherId } } },
      },
      include: { shareGroup: { select: { createdById: true } } },
      orderBy: { createdAt: "desc" },
    });
    for (const t of mine)
      (t.shareGroup?.createdById === userId ? out.toThem : out.fromThem).push(
        tripItem(t, "linked")
      );
    return out;
  }
  const members = await prisma.tripShareRemoteMember.findMany({
    where: { remoteId: target.row.id, state: { in: ["active", "invited"] } },
    include: { group: { include: { trips: { where: { userId } } } } },
  });
  for (const m of members)
    for (const t of m.group.trips)
      (m.group.homeOrigin ? out.fromThem : out.toThem).push(
        tripItem(t, m.state === "active" ? "linked" : "pending")
      );
  return out;
}

export async function friendPlans(userId: string, key: string): Promise<FriendPlan[]> {
  const target = await resolveFriend(userId, key);
  if (target.type === "comparison")
    throw friendsError("FRIENDS_NOT_FOUND", 404, "No plans with a comparison-only friend", {
      userId,
    });
  if (target.type === "local") {
    const rows = await prisma.travelPlanMember.findMany({
      where: {
        kind: "local",
        status: { in: MEMBER_LIVE },
        OR: [
          { userId: target.otherId, plan: { trip: { userId } } },
          { userId, plan: { trip: { userId: target.otherId } } },
        ],
      },
      include: {
        plan: {
          include: {
            trip: {
              select: { id: true, name: true, userId: true, startDate: true, endDate: true },
            },
          },
        },
      },
    });
    return rows.map((m) => ({
      id: m.plan.trip.id,
      title: m.plan.trip.name,
      startDate: m.plan.trip.startDate?.toISOString() ?? null,
      endDate: m.plan.trip.endDate?.toISOString() ?? null,
      owner: m.plan.trip.userId === userId ? ("me" as const) : ("them" as const),
      role: m.role,
    }));
  }
  const [hosted, joined] = await Promise.all([
    prisma.travelPlanMember.findMany({
      where: { connectionId: target.row.id, status: { in: MEMBER_LIVE } },
      include: {
        plan: {
          include: { trip: { select: { id: true, name: true, startDate: true, endDate: true } } },
        },
      },
    }),
    prisma.remotePlanMembership.findMany({
      where: { userId, connectionId: target.row.id, state: { in: MEMBER_LIVE } },
    }),
  ]);
  return [
    ...hosted.map((m) => ({
      id: m.plan.trip.id,
      title: m.plan.trip.name,
      startDate: m.plan.trip.startDate?.toISOString() ?? null,
      endDate: m.plan.trip.endDate?.toISOString() ?? null,
      owner: "me" as const,
      role: m.role,
    })),
    ...joined.map((m) => ({
      id: m.tripId,
      title: m.title,
      startDate: null,
      endDate: null,
      owner: "them" as const,
      role: m.role,
    })),
  ];
}

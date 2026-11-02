/**
 * Who may open a plan, and as whom (spec 2026-10-17 §6.1, §6.4).
 *
 * The plan belongs to its trip's owner. A local member is an account on this server that the
 * owner invited, that accepted, and whose consent pair with the owner still stands in BOTH
 * directions. A person who is neither gets the same 404 as a plan that does not exist, so a
 * trip id never confirms that somebody has planned on it.
 *
 * Remote guests (§6.5) have their columns on `TravelPlanMember` and no way in yet: `kind:
 * "remote"` is never resolved here.
 */
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { hasAcceptedConsent } from "../sharing/consent";
import { toPerson, PERSON_SELECT } from "../sharing/people";
import type { PlanSelf } from "./types";

type Client = Pick<DbTransaction, "travelPlanMember" | "user">;

export const notFound = () => new AppError("Plan not found", 404, "PLAN_NOT_FOUND");

export interface AccessMember {
  id: string;
  kind: "owner" | "local" | "remote";
  displayName: string;
}

/** The owner's member row, created on first use (plans older than members have none). */
export async function ensureOwnerMember(
  client: Client,
  planId: string,
  ownerId: string
): Promise<AccessMember> {
  const found = await client.travelPlanMember.findFirst({
    where: { planId, userId: ownerId, kind: "owner" },
    select: { id: true, displayName: true },
  });
  if (found) return { id: found.id, kind: "owner", displayName: found.displayName };
  const user = await client.user.findUnique({ where: { id: ownerId }, select: PERSON_SELECT });
  if (!user) throw notFound();
  try {
    const created = await client.travelPlanMember.create({
      data: {
        planId,
        kind: "owner",
        userId: ownerId,
        displayName: toPerson(user).displayName,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      },
      select: { id: true, displayName: true },
    });
    return { id: created.id, kind: "owner", displayName: created.displayName };
  } catch (error) {
    // A second request created it first.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await client.travelPlanMember.findFirstOrThrow({
      where: { planId, userId: ownerId, kind: "owner" },
      select: { id: true, displayName: true },
    });
    return { id: raced.id, kind: "owner", displayName: raced.displayName };
  }
}

export async function planAccess(userId: string, tripId: string) {
  const row = await prisma.travelPlan.findFirst({
    where: { tripId },
    include: { trip: { select: { name: true, id: true, userId: true } } },
  });
  if (!row) throw notFound();
  const ownerId = row.trip.userId;
  if (ownerId === userId) {
    return {
      row,
      ownerId,
      isOwner: true as const,
      member: await ensureOwnerMember(prisma, row.id, ownerId),
    };
  }
  const member = await prisma.travelPlanMember.findFirst({
    where: { planId: row.id, userId, kind: "local", status: "active" },
    select: { id: true, displayName: true },
  });
  if (!member) throw notFound();
  // Consent is not a one-time gate: withdrawing it from either side ends the access at once,
  // without anybody having to find the member row.
  const [toThem, toMe] = await Promise.all([
    hasAcceptedConsent(prisma, ownerId, userId),
    hasAcceptedConsent(prisma, userId, ownerId),
  ]);
  if (!toThem || !toMe)
    throw new AppError(
      "Sharing consent with the plan's owner was withdrawn",
      403,
      "PLAN_MEMBER_CONSENT_WITHDRAWN"
    );
  return {
    row,
    ownerId,
    isOwner: false as const,
    member: { id: member.id, kind: "local" as const, displayName: member.displayName },
  };
}
export type PlanAccess = Awaited<ReturnType<typeof planAccess>>;

export function selfOf(access: Pick<PlanAccess, "member" | "isOwner">): PlanSelf {
  return { memberId: access.member.id, kind: access.member.kind, isOwner: access.isOwner };
}

/** Owner-only acts: deleting the plan, managing members, the AI policy (D3). */
export function assertOwner(access: Pick<PlanAccess, "isOwner">): void {
  if (!access.isOwner)
    throw new AppError("Only the plan's owner may do this", 403, "PLAN_OWNER_ONLY");
}

/** A plan the caller may read and edit, in the shape `ownedPlan` returns. */
export async function accessiblePlan(userId: string, tripId: string) {
  return (await planAccess(userId, tripId)).row;
}

/**
 * Who may open a plan, and as whom (spec 2026-10-17 §6.1, §6.4).
 *
 * The plan belongs to its trip's owner. A local member is an account on this server that the
 * owner invited, that accepted, and whose consent pair with the owner still stands in BOTH
 * directions. A person who is neither gets the same 404 as a plan that does not exist, so a
 * trip id never confirms that somebody has planned on it.
 *
 * A remote guest (§6.5) is not a user: it arrives as a `GuestActor` that the guest router built
 * from a verified `ts_guest` credential. It is resolved against ONE plan - the one its credential
 * names - and against its member row's current status, so a removal takes effect inside a
 * request already running. A `kind: "remote"` row is never reachable through a user id.
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

/** A guest from another server, as the guest router hands it to the plan services. */
export interface GuestActor {
  guest: { memberId: string; planId: string };
}
/** Whoever acts on a plan: an account on this server (its id) or a remote guest. */
export type PlanActor = string | GuestActor;

export const isGuest = (actor: PlanActor): actor is GuestActor => typeof actor !== "string";

/** The account that pays for quota and owns the records an act touches: the owner for a guest. */
export async function quotaUserOf(actor: PlanActor, tripId: string): Promise<string> {
  if (!isGuest(actor)) return actor;
  return (await planAccess(actor, tripId)).ownerId;
}

export async function planAccess(actor: PlanActor, tripId: string) {
  const row = await prisma.travelPlan.findFirst({
    where: { tripId },
    include: { trip: { select: { name: true, id: true, userId: true } } },
  });
  if (!row) throw notFound();
  const ownerId = row.trip.userId;
  if (isGuest(actor)) {
    // One plan only: a credential for another plan is not a credential for this one.
    if (actor.guest.planId !== row.id) throw notFound();
    const guest = await prisma.travelPlanMember.findFirst({
      where: { id: actor.guest.memberId, planId: row.id, kind: "remote", status: "active" },
      select: { id: true, displayName: true },
    });
    if (!guest) throw notFound();
    return {
      row,
      ownerId,
      isOwner: false as const,
      member: { id: guest.id, kind: "remote" as const, displayName: guest.displayName },
    };
  }
  const userId = actor;
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
export async function accessiblePlan(actor: PlanActor, tripId: string) {
  return (await planAccess(actor, tripId)).row;
}

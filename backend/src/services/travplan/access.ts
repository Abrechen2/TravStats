/**
 * Who may open a plan, and as whom (spec 2026-10-17 §6.1, §6.4).
 *
 * The plan belongs to its trip's owner. A local member is an account on this server that the
 * owner invited, that accepted, and whose consent pair with the owner still stands in BOTH
 * directions. A person who is neither gets the same 404 as a plan that does not exist, so a
 * trip id never confirms that somebody has planned on it.
 *
 * A remote member (spec 2026-11-02 §4) is not a user of this server: it arrives as a `RemoteActor`
 * that the peer handler built from a signed message - the channel resolved to a connection, the
 * connection to a member row. It is resolved against ONE plan and against its member row's
 * current status AND its connection's current state and switches, so a removal, a revoked
 * connection or a switch turned off takes effect inside a request already running. A
 * `kind: "remote"` row is never reachable through a user id.
 */
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { mayWorkOnPlan } from "../friends/authz";
import { toPerson, PERSON_SELECT } from "../sharing/people";
import { connectionAllowsPlans } from "../sharing/federation/connections/switches";
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

/** A member from another server, as the peer handler hands it to the plan services. */
export interface RemoteActor {
  remote: { memberId: string; planId: string };
}
/** Whoever acts on a plan: an account on this server (its id) or a remote member. */
export type PlanActor = string | RemoteActor;

export const isRemote = (actor: PlanActor): actor is RemoteActor => typeof actor !== "string";

/** The account that pays for quota and owns the records an act touches: the owner for a remote member. */
export async function quotaUserOf(actor: PlanActor, tripId: string): Promise<string> {
  if (!isRemote(actor)) return actor;
  return (await planAccess(actor, tripId)).ownerId;
}

export async function planAccess(actor: PlanActor, tripId: string) {
  const row = await prisma.travelPlan.findFirst({
    where: { tripId },
    include: { trip: { select: { name: true, id: true, userId: true } } },
  });
  if (!row) throw notFound();
  const ownerId = row.trip.userId;
  if (isRemote(actor)) {
    // One plan only: a member of another plan is not a member of this one.
    if (actor.remote.planId !== row.id) throw notFound();
    const remote = await prisma.travelPlanMember.findFirst({
      where: { id: actor.remote.memberId, planId: row.id, kind: "remote", status: "active" },
      select: { id: true, displayName: true, connection: true },
    });
    if (!remote) throw notFound();
    // Not a one-time gate either: the connection must still be active with plans on both sides.
    if (!remote.connection || !connectionAllowsPlans(remote.connection))
      throw new AppError("Plan sharing with that person ended", 403, "REMOTE_PLAN_NOT_SHARED");
    return {
      row,
      ownerId,
      isOwner: false as const,
      member: { id: remote.id, kind: "remote" as const, displayName: remote.displayName },
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
  // Not a one-time gate: without a connection, withdrawing the consent from either side ends the
  // access at once; with one, a plan already joined stays open (friends/authz.ts),
  // and nobody has to find the member row.
  if (!(await mayWorkOnPlan(prisma, ownerId, userId)))
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

/**
 * Co-planners on the same server (forgejo#404, spec 2026-10-17 §6.1, §6.4, §6.6).
 *
 * The owner invites an account by username; that needs the sharing consent accepted in both
 * directions (owner rule 2026-10-16). The invitee accepts or declines. A member works on the plan
 * through their own session; at handover each active member receives a linked copy of the trip
 * through the existing trip sharing, so facts sync and private fields stay private.
 */
import { prisma } from "../../db";
import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { hasAcceptedConsent } from "../sharing/consent";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { shareTripWithUser } from "../sharing/shareTrip";
import { assertOwner, planAccess, selfOf } from "./access";
import type { PlanAccess } from "./access";
import type { PlanCollab, PlanMember, PlanMemberShare, PlanNotice } from "./types";

/** Active plus invited members besides the owner; the state's per-member arrays are sized to it. */
export const MAX_PLAN_MEMBERS = 10;

type Row = Awaited<ReturnType<typeof prisma.travelPlanMember.findFirstOrThrow>>;
const KINDS = ["owner", "local", "remote"] as const;
const STATUSES = ["invited", "active", "left", "revoked"] as const;

function toMember(row: Row, username: string | null, forOwner: boolean): PlanMember {
  return {
    id: row.id,
    kind: KINDS.find((k) => k === row.kind) ?? "local",
    displayName: row.displayName,
    username: forOwner ? username : null,
    role: row.role === "owner" ? "owner" : "editor",
    status: STATUSES.find((s) => s === row.status) ?? "revoked",
    createdAt: row.invitedAt.toISOString(),
    decidedAt: row.joinedAt?.toISOString() ?? null,
    shared: row.sharedAt !== null,
  };
}

/** Members that currently work on the plan. */
export async function activeMemberIds(
  client: Pick<DbTransaction, "travelPlanMember">,
  planId: string
): Promise<Set<string>> {
  const rows = await client.travelPlanMember.findMany({
    where: { planId, status: "active" },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function collab(userId: string, tripId: string): Promise<PlanCollab> {
  const access = await planAccess(userId, tripId);
  const rows = await prisma.travelPlanMember.findMany({
    where: {
      planId: access.row.id,
      ...(access.isOwner ? {} : { status: "active" }),
    },
    include: { user: { select: { username: true } } },
    orderBy: [{ kind: "desc" }, { invitedAt: "asc" }],
  });
  const notices = await prisma.travelPlanNotice.findMany({
    where: { recipientId: access.member.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return {
    self: selfOf(access),
    // The owner first, then by invitation.
    members: rows
      .map((r) => toMember(r, r.user?.username ?? null, access.isOwner))
      .sort((a, b) => Number(b.kind === "owner") - Number(a.kind === "owner")),
    notices: notices.map((n): PlanNotice => ({
      id: n.id,
      actorName: n.actorName,
      summary: n.summary,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markNoticesRead(userId: string, tripId: string): Promise<{ read: number }> {
  const access = await planAccess(userId, tripId);
  const done = await prisma.travelPlanNotice.updateMany({
    where: { recipientId: access.member.id, readAt: null },
    data: { readAt: new Date() },
  });
  return { read: done.count };
}

/** Tells every other active member what one member changed (spec §6.3). */
export async function recordNotices(
  tx: Pick<DbTransaction, "travelPlanMember" | "travelPlanNotice">,
  input: {
    planId: string;
    mutationId: string;
    actor: { id: string; displayName: string };
    summary: string;
  }
): Promise<void> {
  const others = await tx.travelPlanMember.findMany({
    where: { planId: input.planId, status: "active", id: { not: input.actor.id } },
    select: { id: true },
  });
  if (!others.length) return;
  await tx.travelPlanNotice.createMany({
    data: others.map((o) => ({
      planId: input.planId,
      recipientId: o.id,
      mutationId: input.mutationId,
      actorMemberId: input.actor.id,
      actorName: input.actor.displayName,
      summary: input.summary,
    })),
  });
}

export async function inviteLocalMember(
  ownerId: string,
  tripId: string,
  username: string
): Promise<PlanMember> {
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const invitee = await prisma.user.findFirst({
    where: { username: { equals: username.trim(), mode: "insensitive" }, isActive: true },
    select: PERSON_SELECT,
  });
  if (!invitee)
    throw new AppError("No such user on this server", 404, "PLAN_MEMBER_USER_NOT_FOUND");
  if (invitee.id === ownerId)
    throw new AppError("The owner is already on the plan", 400, "PLAN_MEMBER_SELF");
  // Both directions, and each says whose answer is missing so the dialog can name the step.
  if (!(await hasAcceptedConsent(prisma, invitee.id, ownerId)))
    throw new AppError(
      "You have not accepted sharing with this person",
      403,
      "PLAN_MEMBER_CONSENT_MINE"
    );
  if (!(await hasAcceptedConsent(prisma, ownerId, invitee.id)))
    throw new AppError(
      "This person has not accepted sharing with you",
      403,
      "PLAN_MEMBER_CONSENT_THEIRS"
    );
  const planId = access.row.id;
  const existing = await prisma.travelPlanMember.findFirst({
    where: { planId, userId: invitee.id },
  });
  if (existing && (existing.status === "invited" || existing.status === "active"))
    throw new AppError("Already invited", 409, "PLAN_MEMBER_DUPLICATE");
  const open = await prisma.travelPlanMember.count({
    where: { planId, kind: { not: "owner" }, status: { in: ["invited", "active"] } },
  });
  if (open >= MAX_PLAN_MEMBERS) throw new AppError("Too many members", 409, "PLAN_MEMBER_LIMIT");
  const data = {
    displayName: toPerson(invitee).displayName,
    status: "invited",
    invitedAt: new Date(),
    joinedAt: null,
    revokedAt: null,
    sharedAt: null,
  };
  const row = existing
    ? await prisma.travelPlanMember.update({ where: { id: existing.id }, data })
    : await prisma.travelPlanMember.create({
        data: { ...data, planId, kind: "local", userId: invitee.id, role: "editor" },
      });
  return toMember(row, invitee.username, true);
}

export interface PlanInvitation {
  memberId: string;
  tripId: string;
  planName: string;
  ownerName: string;
  createdAt: string;
}

export async function listInvitations(userId: string): Promise<PlanInvitation[]> {
  const rows = await prisma.travelPlanMember.findMany({
    where: { userId, kind: "local", status: "invited" },
    include: { plan: { include: { trip: { select: { id: true, name: true, userId: true } } } } },
    orderBy: { invitedAt: "desc" },
    take: 50,
  });
  const owners = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.plan.trip.userId) } },
    select: PERSON_SELECT,
  });
  return rows.map((r) => {
    const owner = owners.find((o) => o.id === r.plan.trip.userId);
    return {
      memberId: r.id,
      tripId: r.plan.trip.id,
      planName: r.plan.trip.name,
      ownerName: owner ? toPerson(owner).displayName : "",
      createdAt: r.invitedAt.toISOString(),
    };
  });
}

export async function respondToInvitation(
  userId: string,
  memberId: string,
  accept: boolean
): Promise<{ status: "active" | "left" }> {
  const row = await prisma.travelPlanMember.findFirst({
    where: { id: memberId, userId, kind: "local", status: "invited" },
    include: { plan: { include: { trip: { select: { userId: true } } } } },
  });
  if (!row) throw new AppError("Invitation not found", 404, "PLAN_MEMBER_NOT_FOUND");
  if (!accept) {
    await prisma.travelPlanMember.update({ where: { id: row.id }, data: { status: "left" } });
    return { status: "left" };
  }
  const ownerId = row.plan.trip.userId;
  // The pair may have changed since the invitation went out.
  const both =
    (await hasAcceptedConsent(prisma, ownerId, userId)) &&
    (await hasAcceptedConsent(prisma, userId, ownerId));
  if (!both)
    throw new AppError(
      "Sharing consent with the plan's owner is missing",
      403,
      "PLAN_MEMBER_CONSENT_WITHDRAWN"
    );
  await prisma.travelPlanMember.update({
    where: { id: row.id },
    data: { status: "active", joinedAt: new Date() },
  });
  return { status: "active" };
}

/** Owner removes a member (or withdraws an open invitation). Their past changes keep their name. */
export async function revokeMember(
  ownerId: string,
  tripId: string,
  memberId: string
): Promise<{ revoked: true }> {
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const done = await prisma.travelPlanMember.updateMany({
    where: {
      id: memberId,
      planId: access.row.id,
      kind: { not: "owner" },
      status: { in: ["invited", "active"] },
    },
    data: { status: "revoked", revokedAt: new Date() },
  });
  if (!done.count) throw new AppError("Member not found", 404, "PLAN_MEMBER_NOT_FOUND");
  return { revoked: true };
}

/** A member leaves. Their linked copy of the trip stays theirs. The owner deletes instead. */
export async function leavePlan(userId: string, tripId: string): Promise<{ left: true }> {
  const access = await planAccess(userId, tripId);
  if (access.isOwner)
    throw new AppError("The owner deletes the plan instead", 409, "PLAN_OWNER_CANNOT_LEAVE");
  await prisma.travelPlanMember.update({
    where: { id: access.member.id },
    data: { status: "left", revokedAt: new Date() },
  });
  return { left: true };
}

/**
 * Gives one member the linked copy of the trip (owner only). The machine code of a refusal comes
 * back instead of being swallowed: a handover that left a member without their copy says so.
 */
export async function shareWithMember(
  access: PlanAccess,
  tripId: string,
  memberId: string
): Promise<PlanMemberShare> {
  const member = await prisma.travelPlanMember.findFirst({
    where: { id: memberId, planId: access.row.id, kind: "local", status: "active" },
    select: { id: true, userId: true, displayName: true },
  });
  if (!member?.userId) throw new AppError("Member not found", 404, "PLAN_MEMBER_NOT_FOUND");
  try {
    await shareTripWithUser(access.ownerId, tripId, member.userId);
    await prisma.travelPlanMember.update({
      where: { id: member.id },
      data: { sharedAt: new Date() },
    });
    return { memberId: member.id, displayName: member.displayName, ok: true };
  } catch (error) {
    const code = error instanceof AppError ? (error.code ?? "UNKNOWN") : "UNKNOWN";
    logger.warn({ operation: "travplan.shareMember", tripId, code }, "member copy failed");
    return { memberId: member.id, displayName: member.displayName, ok: false, code };
  }
}

export async function shareWithAllMembers(
  access: PlanAccess,
  tripId: string
): Promise<PlanMemberShare[]> {
  const members = await prisma.travelPlanMember.findMany({
    where: { planId: access.row.id, kind: "local", status: "active" },
    select: { id: true },
  });
  const results: PlanMemberShare[] = [];
  for (const m of members) results.push(await shareWithMember(access, tripId, m.id));
  return results;
}

export async function shareWithMemberFor(
  ownerId: string,
  tripId: string,
  memberId: string
): Promise<PlanMemberShare> {
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  return shareWithMember(access, tripId, memberId);
}

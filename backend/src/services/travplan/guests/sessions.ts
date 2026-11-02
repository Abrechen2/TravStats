/**
 * Guest credentials (spec 2026-10-17 §6.5 step 4, §6.7 "Security"): the `ts_guest` browser
 * session and the `ts_gpat_` phone token, each scoped to ONE plan and stored as a hash.
 *
 * Every check fails closed and runs on every request, not once at issue: the member must still be
 * `active`, and the guest's server must still be pinned, enabled, verified AND under the same
 * key it had when the credential was issued. A removed guest, an unpinned server, a re-pinned
 * key or a restore therefore ends access immediately, whatever the cookie says.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { DbTransaction } from "../../../db";
import { requireVerifiedPeer, pinFingerprint, guestIdentity } from "./peers";

export const SESSION_DAYS = 30;
export const PAT_DAYS = 90;
export const MAX_PATS_PER_MEMBER = 5;
export const GUEST_COOKIE = "ts_guest";
export const PAT_PREFIX = "ts_gpat_";
const DAY_MS = 86_400_000;
/** A sliding expiry is renewed at most this often, so a read is not a write. */
const SLIDE_AFTER_MS = 3_600_000;

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface GuestPrincipal {
  memberId: string;
  planId: string;
  tripId: string;
  displayName: string;
  credentialId: string;
  kind: "session" | "pat";
  origin: string;
  /** Set when this request slid the session's expiry: the cookie is re-sent with it. */
  renewedUntil?: Date;
}

const refuse = (code: "PLAN_GUEST_REQUIRED" | "PLAN_GUEST_EXPIRED" | "PLAN_GUEST_REVOKED") =>
  new AppError(
    code === "PLAN_GUEST_REQUIRED"
      ? "Guest sign-in required"
      : code === "PLAN_GUEST_EXPIRED"
        ? "Guest session expired"
        : "Guest access ended",
    401,
    code
  );

type Client = Pick<DbTransaction, "travelPlanGuestSession" | "$queryRaw">;
export async function issueCredential(
  input: {
    memberId: string;
    planId: string;
    kind: "session" | "pat";
    origin: string;
  },
  client: Client = prisma
): Promise<{ token: string; expiresAt: Date }> {
  const fingerprint = await pinFingerprint(input.origin);
  if (!fingerprint)
    throw new AppError("That server is not admitted", 403, "PLAN_GUEST_PEER_NOT_ADMITTED");
  if (input.kind === "pat") return mintPat(input, fingerprint);
  const raw = randomBytes(32).toString("base64url");
  const token = raw;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await client.travelPlanGuestSession.create({
    data: {
      memberId: input.memberId,
      planId: input.planId,
      kind: input.kind,
      tokenHash: hashToken(token),
      peerFingerprint: fingerprint,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/** Phone tokens: the member row is locked for the count and the insert, so five means five. */
async function mintPat(
  input: { memberId: string; planId: string },
  fingerprint: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = PAT_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PAT_DAYS * DAY_MS);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM travel_plan_members WHERE id = ${input.memberId} FOR UPDATE`;
    const open = await tx.travelPlanGuestSession.count({
      where: { memberId: input.memberId, kind: "pat", expiresAt: { gt: new Date() } },
    });
    if (open >= MAX_PATS_PER_MEMBER)
      throw new AppError("Too many phone tokens", 409, "PLAN_GUEST_PAT_LIMIT");
    await tx.travelPlanGuestSession.create({
      data: {
        memberId: input.memberId,
        planId: input.planId,
        kind: "pat",
        tokenHash: hashToken(token),
        peerFingerprint: fingerprint,
        expiresAt,
      },
    });
  });
  return { token, expiresAt };
}

/** The principal behind a token, or a refusal with its own code. Never a user. */
export async function authenticateCredential(
  token: string | undefined,
  kind: "session" | "pat"
): Promise<GuestPrincipal> {
  if (!token) throw refuse("PLAN_GUEST_REQUIRED");
  if (kind === "pat" ? !token.startsWith(PAT_PREFIX) : token.startsWith(PAT_PREFIX))
    throw refuse("PLAN_GUEST_REQUIRED");
  const row = await prisma.travelPlanGuestSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      member: {
        include: { plan: { select: { id: true, tripId: true } } },
      },
    },
  });
  if (!row || row.kind !== kind) throw refuse("PLAN_GUEST_REQUIRED");
  // Federation switched off ends guest access like an unpinned server does.
  try {
    await guestIdentity();
  } catch {
    throw refuse("PLAN_GUEST_REVOKED");
  }
  if (row.expiresAt.getTime() <= Date.now()) throw refuse("PLAN_GUEST_EXPIRED");
  const member = row.member;
  if (
    member.kind !== "remote" ||
    member.status !== "active" ||
    !member.remoteOrigin ||
    member.planId !== row.planId
  )
    throw refuse("PLAN_GUEST_REVOKED");
  // The guest's server must still be the one we pinned, under the key it had.
  if ((await pinFingerprint(member.remoteOrigin)) !== row.peerFingerprint)
    throw refuse("PLAN_GUEST_REVOKED");
  let renewedUntil: Date | undefined;
  if (Date.now() - row.lastUsedAt.getTime() > SLIDE_AFTER_MS) {
    renewedUntil = kind === "session" ? new Date(Date.now() + SESSION_DAYS * DAY_MS) : undefined;
    await prisma.travelPlanGuestSession.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), ...(renewedUntil ? { expiresAt: renewedUntil } : {}) },
    });
  }
  return {
    memberId: member.id,
    planId: member.planId,
    tripId: member.plan.tripId,
    displayName: member.displayName,
    credentialId: row.id,
    kind,
    origin: member.remoteOrigin,
    renewedUntil,
  };
}

export async function endCredential(credentialId: string): Promise<void> {
  await prisma.travelPlanGuestSession.deleteMany({ where: { id: credentialId } });
}

/**
 * Takes a guest's access away NOW: the member is revoked (their past changes keep their name),
 * every credential and open invitation of theirs is deleted, and the pseudonym is released so a
 * later invitation can bring the same person back.
 */
export async function endGuestAccess(
  memberIds: string[],
  status: "revoked" | "left" = "revoked"
): Promise<number> {
  if (!memberIds.length) return 0;
  const [, , members] = await prisma.$transaction([
    prisma.travelPlanGuestSession.deleteMany({ where: { memberId: { in: memberIds } } }),
    prisma.travelPlanGuestInvite.deleteMany({ where: { memberId: { in: memberIds } } }),
    prisma.travelPlanMember.updateMany({
      where: { id: { in: memberIds }, kind: "remote", status: { in: ["invited", "active"] } },
      data: { status, revokedAt: new Date(), remoteSubject: null },
    }),
  ]);
  return members.count;
}

/** Every remote member of one server: its pin was replaced, suspended or removed. */
export async function endGuestsOfOrigin(origin: string | null): Promise<number> {
  const rows = await prisma.travelPlanMember.findMany({
    where: {
      kind: "remote",
      status: { in: ["invited", "active"] },
      ...(origin ? { remoteOrigin: origin } : {}),
    },
    select: { id: true },
  });
  return endGuestAccess(rows.map((r) => r.id));
}

/** A sweep for expired credentials, joins and invitations; called by the cron job. */
export async function sweepGuestRows(now = new Date()): Promise<number> {
  const [a, b, c] = await prisma.$transaction([
    prisma.travelPlanGuestSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.travelPlanGuestJoin.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.travelPlanGuestInvite.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date(now.getTime() - DAY_MS) } }, { usedAt: { not: null } }],
      },
    }),
  ]);
  return a.count + b.count + c.count;
}

export { requireVerifiedPeer };

/**
 * After a restore the database is an older one: its guests were admitted under pins and sessions
 * that may since have been withdrawn. Every guest and every credential goes; the owner invites
 * again (spec §6.5 "restore starts with every remote member suspended").
 */
export async function endAllGuestsAfterRestore(): Promise<void> {
  await endGuestsOfOrigin(null);
  await prisma.$transaction([
    prisma.travelPlanGuestSession.deleteMany(),
    prisma.travelPlanGuestJoin.deleteMany(),
    prisma.travelPlanGuestInvite.deleteMany(),
  ]);
}

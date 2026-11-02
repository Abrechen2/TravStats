/**
 * Claim codes (forgejo#404): how a phone gets a `ts_gpat_` token without a live credential ever
 * sitting in a QR code or a URL. A browser guest session mints a code; the Companion scans it and
 * redeems it once for a phone token. A code is short-lived, single use, bound to one member and
 * one plan, and stored as a hash. Every way a redemption can fail answers the same refusal, so a
 * code cannot be probed for "used" versus "expired" versus "other plan".
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { hashToken, issueCredential } from "./sessions";

export const CLAIM_MINUTES = 5;
export const CLAIM_CODE_LENGTH = 10;
/** No 0/O/1/I/L: a code is also typed by hand when the camera fails. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

const invalid = () => new AppError("That code is not valid", 400, "PLAN_GUEST_CLAIM_INVALID");

/** Upper-cased, separators dropped: what the hash is taken over. */
export const normaliseCode = (code: string): string => code.toUpperCase().replace(/[\s-]/g, "");

const newCode = (): string => {
  const bytes = randomBytes(CLAIM_CODE_LENGTH);
  // 30 symbols; the modulo bias over 256 is below 1 symbol in 8 and irrelevant at 30^10.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
};

export async function mintClaimCode(input: {
  memberId: string;
  planId: string;
}): Promise<{ code: string; expiresAt: Date }> {
  const code = newCode();
  const expiresAt = new Date(Date.now() + CLAIM_MINUTES * 60_000);
  await prisma.$transaction(async (tx) => {
    // The member row is the lock, so two quick requests cannot both leave a code behind.
    await tx.$queryRaw`SELECT id FROM travel_plan_members WHERE id = ${input.memberId} FOR UPDATE`;
    // One open code per member: a fresh QR retires the one before it.
    await tx.travelPlanGuestClaim.deleteMany({ where: { memberId: input.memberId, usedAt: null } });
    await tx.travelPlanGuestClaim.create({
      data: {
        memberId: input.memberId,
        planId: input.planId,
        codeHash: hashToken(code),
        expiresAt,
      },
    });
  });
  return { code, expiresAt };
}

export async function redeemClaimCode(
  planId: string,
  rawCode: string
): Promise<{ token: string; expiresAt: Date }> {
  // The single atomic step: only one caller can flip `usedAt`, whatever else happens next.
  const codeHash = hashToken(normaliseCode(rawCode));
  const claimed = await prisma.travelPlanGuestClaim.updateManyAndReturn({
    where: {
      codeHash,
      planId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
    select: { memberId: true },
  });
  if (claimed.length !== 1) throw invalid();
  try {
    return await issueFor(claimed[0].memberId, planId);
  } catch (error) {
    // A token the person never received must not cost them the code (limit reached, database
    // hiccup). A refusal that says the member is gone also frees it; it expires on its own.
    await prisma.travelPlanGuestClaim.updateMany({ where: { codeHash }, data: { usedAt: null } });
    throw error;
  }
}

async function issueFor(memberId: string, planId: string) {
  const member = await prisma.travelPlanMember.findUnique({
    where: { id: memberId },
    select: { id: true, planId: true, kind: true, status: true, remoteOrigin: true },
  });
  if (
    !member ||
    member.kind !== "remote" ||
    member.status !== "active" ||
    member.planId !== planId ||
    !member.remoteOrigin
  )
    throw invalid();
  return issueCredential({
    memberId: member.id,
    planId,
    kind: "pat",
    origin: member.remoteOrigin,
  });
}

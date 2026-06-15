/**
 * Device-pairing claim-code service.
 *
 * A browser session generates a short-lived pairing code (10 minutes). Only
 * the SHA-256 of the code is persisted (`codeHash`) — the plaintext is shown
 * to the user (QR / typed) and never stored, mirroring the PAT design in
 * `utils/apiTokens.ts`. The mobile app posts the plaintext back to claim it;
 * `verifyAndConsume` atomically consumes the row so a concurrent double-claim
 * can never mint two tokens from one code.
 */

import { randomBytes } from "node:crypto";

import { prisma } from "../../db";
import { tokenLookupHash } from "../../utils/apiTokens";

/** Plaintext pairing-code prefix — `clm_` for "claim". */
export const PAIRING_CODE_PREFIX = "clm_";

/** 16 random bytes → 32 hex chars after the prefix. */
const PAIRING_CODE_BYTES = 16;

/** Codes are valid for 10 minutes from creation. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface GeneratedPairingCode {
  /** Plaintext code (`clm_<32hex>`). Returned once; never persisted. */
  code: string;
  /** Expiry instant (now + TTL). */
  expiresAt: Date;
}

export interface PairingStatus {
  /** True when a row exists for the code (regardless of consumed state). */
  found: boolean;
  /** True once the code has been consumed by a successful claim. */
  claimed: boolean;
  /** Best-effort label of the device that claimed the code, if known. */
  deviceName?: string;
}

/**
 * Generate a new pairing code for the given user and persist its SHA-256.
 * Returns the plaintext code and its expiry — the caller surfaces the code to
 * the user and discards it.
 */
export async function generatePairingCode(userId: string): Promise<GeneratedPairingCode> {
  const code = `${PAIRING_CODE_PREFIX}${randomBytes(PAIRING_CODE_BYTES).toString("hex")}`;
  const codeHash = tokenLookupHash(code);
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

  await prisma.pairingCode.create({
    data: { codeHash, userId, expiresAt },
  });

  return { code, expiresAt };
}

/**
 * Atomically verify and consume a pairing code.
 *
 * Finds an unconsumed, unexpired row by SHA-256 and conditionally stamps
 * `consumedAt`. The conditional `updateMany` (where `consumedAt = null`) is the
 * concurrency guard: under READ COMMITTED two racing claims serialize on the
 * row lock, and the loser re-evaluates the WHERE against the now-consumed row
 * and matches zero rows. Only the winner sees `count === 1`.
 *
 * @returns the owning userId on success, or `null` when the code is unknown,
 *          expired, or already consumed.
 */
export async function verifyAndConsume(code: string): Promise<string | null> {
  const codeHash = tokenLookupHash(code);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const consumed = await tx.pairingCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return null;

    const row = await tx.pairingCode.findUnique({
      where: { codeHash },
      select: { userId: true },
    });
    return row?.userId ?? null;
  });
}

/**
 * Look up the status of a pairing code by its plaintext. Used by the browser
 * polling endpoint to learn when the phone has claimed the code.
 *
 * `deviceName` is best-effort: there is no hard FK from a code to the token it
 * minted, so we surface the label of the most recent device token created for
 * the owning user at/after the code was consumed.
 */
export async function getPairingStatus(code: string): Promise<PairingStatus> {
  const codeHash = tokenLookupHash(code);
  const row = await prisma.pairingCode.findUnique({
    where: { codeHash },
    select: { userId: true, consumedAt: true },
  });

  if (!row) return { found: false, claimed: false };
  if (!row.consumedAt) return { found: true, claimed: false };

  const token = await prisma.apiToken.findFirst({
    where: {
      userId: row.userId,
      deviceId: { not: null },
      createdAt: { gte: row.consumedAt },
    },
    orderBy: { createdAt: "desc" },
    select: { label: true },
  });

  return {
    found: true,
    claimed: true,
    ...(token?.label ? { deviceName: token.label } : {}),
  };
}

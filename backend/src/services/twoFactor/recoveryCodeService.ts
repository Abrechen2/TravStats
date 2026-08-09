import crypto from "crypto";
import { prisma } from "../../db";
import { hashPassword, comparePassword } from "../../utils/password";

export const RECOVERY_CODE_COUNT = 10;

// Look-alikes cost support time when a code is read off a printout and typed
// by hand, so "0/O", "1/l" and "i" are out. Vowels are out too, so a random
// code can't accidentally spell something unfortunate; "y" stays — it isn't
// a vowel in the sense that matters here and it isn't a look-alike either.
export const ALPHABET = "bcdfghjkmnpqrstvwxyz23456789";

function randomChunk(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function newCode(): string {
  return `${randomChunk(5)}-${randomChunk(5)}`;
}

function normalise(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * Issue a fresh set, replacing any existing one. The plaintext codes are
 * returned exactly once — after this call only hashes remain, so a user who
 * loses the sheet regenerates rather than recovers it.
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const candidate = newCode();
    if (!codes.includes(candidate)) codes.push(candidate);
  }

  const hashes = await Promise.all(codes.map((code) => hashPassword(code)));

  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  return codes;
}

/**
 * Spend a code. Returns false for an unknown code, an already-used one, or a
 * code belonging to another account — the caller cannot tell which, on purpose.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const candidate = normalise(code);
  const rows = await prisma.twoFactorRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const row of rows) {
    if (await comparePassword(candidate, row.codeHash)) {
      // Conditional update: two parallel logins racing on the same code means
      // exactly one of them updates a row that still had usedAt = null.
      const claimed = await prisma.twoFactorRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return claimed.count === 1;
    }
  }
  return false;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
}

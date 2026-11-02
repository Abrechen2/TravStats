/**
 * The token behind a user's forwarding address (`trips+k7m2q9xwab@example.org`).
 *
 * Stored as a SHA-256 hash for lookup (like share-link tokens) and, because the
 * settings page must show the address again, also encrypted. Mail to a token
 * nobody holds is rejected, never guessed into an account.
 */
import crypto from "crypto";

import { prisma } from "../../db";
import { decrypt, encrypt } from "../../utils/encryption";

/** No 0/o, 1/l/i — an address read aloud or typed from a screenshot stays unambiguous. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const TOKEN_LENGTH = 10;
const TOKEN_IN_ADDRESS = /\+([a-z0-9]{6,32})@/gi;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token.toLowerCase()).digest("hex");
}

export function generateToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i += 1) token += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return token;
}

/** `trips@example.org` + `k7m2…` → `trips+k7m2…@example.org`; null if the mailbox login is no address. */
export function addressFor(
  mailboxAddress: string | null | undefined,
  token: string
): string | null {
  const at = mailboxAddress?.lastIndexOf("@") ?? -1;
  if (!mailboxAddress || at < 1) return null;
  return `${mailboxAddress.slice(0, at)}+${token}${mailboxAddress.slice(at)}`;
}

/** Every `+token` found in the given header values, in order, deduplicated. */
export function tokensIn(values: ReadonlyArray<string | undefined>): string[] {
  const found: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(TOKEN_IN_ADDRESS)) {
      const token = match[1].toLowerCase();
      if (!found.includes(token)) found.push(token);
    }
  }
  return found;
}

export async function userIdForToken(token: string): Promise<string | null> {
  const row = await prisma.mailIntakeAddress.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

/** Issues a fresh token for the user; the previous one stops working at once. */
export async function rotateToken(userId: string): Promise<string> {
  const token = generateToken();
  const data = {
    tokenHash: hashToken(token),
    tokenEncrypted: encrypt(token),
    createdAt: new Date(),
  };
  await prisma.mailIntakeAddress.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return token;
}

export async function currentToken(userId: string): Promise<string | null> {
  const row = await prisma.mailIntakeAddress.findUnique({ where: { userId } });
  if (!row) return null;
  try {
    return decrypt(row.tokenEncrypted);
  } catch {
    return null;
  }
}

export async function revokeToken(userId: string): Promise<void> {
  await prisma.mailIntakeAddress.deleteMany({ where: { userId } });
}

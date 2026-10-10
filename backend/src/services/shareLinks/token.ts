import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The secret of a public share link (forgejo#281).
 *
 * 32 bytes from the CSPRNG — 256 bits, far past the ≥128 the design asks for —
 * written as base64url after a fixed prefix, so a leaked link is recognisable
 * in a log, a chat export or a secret scanner. Only the SHA-256 is stored, as
 * for pairing codes (`services/pairing/pairingService.ts`): a 256-bit secret
 * cannot be found from its hash by guessing, so a slow hash (the PATs' bcrypt)
 * would add cost to every page view and no protection.
 */
export const SHARE_TOKEN_PREFIX = "ts_share_";
const TOKEN_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

/** Anything token-shaped, for redacting it out of a log line. */
export const SHARE_TOKEN_PATTERN = /ts_share_[A-Za-z0-9_-]+/g;

export function generateShareToken(): { token: string; tokenHash: string } {
  const token = `${SHARE_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, tokenHash: shareTokenHash(token) };
}

export function shareTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Structural check before any database work: garbage never reaches a query. */
export function looksLikeShareToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(SHARE_TOKEN_PREFIX) &&
    TOKEN_BODY.test(value.slice(SHARE_TOKEN_PREFIX.length))
  );
}

/**
 * Constant-time comparison of a candidate token against a stored hash. The row
 * was found by the hash's unique index, so this only ever confirms; it exists
 * so that no code path compares secrets with `===`.
 */
export function shareTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(shareTokenHash(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

import { createHash, randomBytes } from "node:crypto";

/**
 * The secret in a calendar subscription URL (forgejo#310).
 *
 * The share-link recipe (`services/shareLinks/token.ts`): 32 bytes from the
 * CSPRNG as base64url after a fixed prefix, so a leaked URL is recognisable in
 * a log, a chat export or a secret scanner. Only the SHA-256 is stored — a
 * 256-bit secret cannot be found from its hash by guessing, so a slow hash
 * would add cost to every calendar poll and no protection.
 *
 * Unlike a share link, this token travels in the URL PATH: a calendar app
 * subscribes to a plain GET and sends nothing else. `requestPathForLog`
 * redacts it from every log line this server writes.
 */
export const CALENDAR_TOKEN_PREFIX = "ts_cal_";
const TOKEN_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

/** Anything token-shaped, for redacting it out of a log line. */
export const CALENDAR_TOKEN_PATTERN = /ts_cal_[A-Za-z0-9_-]+/g;

export function generateCalendarToken(): { token: string; tokenHash: string } {
  const token = `${CALENDAR_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, tokenHash: calendarTokenHash(token) };
}

export function calendarTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Structural check before any database work: garbage never reaches a query. */
export function looksLikeCalendarToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(CALENDAR_TOKEN_PREFIX) &&
    TOKEN_BODY.test(value.slice(CALENDAR_TOKEN_PREFIX.length))
  );
}

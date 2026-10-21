/**
 * The trip-share invitation code: `<origin>#trip:<64 hex>` (spec 2026-10-20 F1). The `trip:` tag
 * makes it unredeemable as a leaderboard code (`<origin>#<64 hex>`, `parseInviteCode` in
 * `services/comparison/remote.ts`) and the other way round: each parser refuses the other's form,
 * and this one says so, so the screen can name the mix-up instead of calling the code invalid.
 */
import { origin as originSchema } from "../../federation/envelope";

export const TRIP_INVITE_TAG = "trip:";

export type ParsedTripInvite =
  | { ok: true; origin: string; secret: string }
  | { ok: false; reason: "invalid" | "leaderboardCode" };

export const formatTripInviteCode = (origin: string, secret: string): string =>
  `${origin}#${TRIP_INVITE_TAG}${secret}`;

export function parseTripInviteCode(code: string): ParsedTripInvite {
  const text = code.trim();
  const at = text.lastIndexOf("#");
  if (at < 0) return { ok: false, reason: "invalid" };
  const origin = text.slice(0, at);
  const rest = text.slice(at + 1);
  if (origin === "local" || !originSchema.safeParse(origin).success)
    return { ok: false, reason: "invalid" };
  if (/^[a-f0-9]{64}$/.test(rest)) return { ok: false, reason: "leaderboardCode" };
  if (!rest.startsWith(TRIP_INVITE_TAG)) return { ok: false, reason: "invalid" };
  const secret = rest.slice(TRIP_INVITE_TAG.length);
  return /^[a-f0-9]{64}$/.test(secret)
    ? { ok: true, origin, secret }
    : { ok: false, reason: "invalid" };
}

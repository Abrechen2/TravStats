import { saveErrorKey } from "../../lib/saveErrorMessage";

/**
 * The sentence a failed share-link action shows (forgejo#281): the server's
 * codes first, then the shared save rules (network, rate limit, demo
 * account), then the action's own fallback. Never the server's English prose.
 */
export function shareLinkErrorKey(err: unknown, fallbackKey: string): string {
  return saveErrorKey(err, fallbackKey, {
    SHARE_LINKS_DISABLED: "sharing:links.errors.disabled",
    SHARE_LINK_FLIGHT_LANDED: "sharing:links.errors.landed",
    SHARE_LINK_LIMIT: "sharing:links.errors.limit",
    SHARE_LINK_EXPIRY_INVALID: "sharing:links.errors.expiry",
    SHARE_LINK_NOT_FOUND: "sharing:links.errors.notFound",
  });
}

/** Expiry choices, in days; `untilLanding` is the server's cap, which the landing cuts short. */
export const EXPIRY_CHOICES = {
  untilLanding: 90,
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
} as const;
export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;

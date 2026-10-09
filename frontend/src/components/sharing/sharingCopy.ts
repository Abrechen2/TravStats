import { saveErrorKey } from "../../lib/saveErrorMessage";

/**
 * The sentence a failed sharing action shows: the server's codes first, then
 * the shared save rules (network, rate limit, demo account), then the action's
 * own fallback. Never the server's English prose.
 */
export function sharingErrorKey(err: unknown, fallbackKey: string): string {
  return saveErrorKey(err, fallbackKey, {
    SHARE_USER_NOT_FOUND: "sharing:errors.userNotFound",
    SHARE_SELF: "sharing:errors.self",
    SHARE_CONSENT_DUPLICATE: "sharing:errors.duplicate",
    SHARE_CONSENT_NOT_FOUND: "sharing:errors.consentNotFound",
    SHARE_CONSENT_NOT_PENDING: "sharing:errors.notPending",
    SHARE_CONSENT_REQUIRED: "sharing:errors.consentRequired",
    COMPANION_NOT_FOUND: "sharing:errors.companionNotFound",
    SHARE_COMPANION_ALREADY_LINKED: "sharing:errors.alreadyLinked",
    SHARE_COMPANION_NOT_LINKED: "sharing:errors.notLinked",
    SHARE_TRIP_NOT_SHARED: "sharing:errors.notShared",
    TRIP_NOT_FOUND: "sharing:errors.tripNotFound",
    SHARE_NOTICE_NOT_FOUND: "sharing:errors.noticeNotFound",
  });
}

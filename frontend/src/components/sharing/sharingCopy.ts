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
    SHARE_UNDO_STALE: "sharing:errors.undoStale",
    SHARE_UNDO_UNAVAILABLE: "sharing:errors.undoUnavailable",
    SHARE_COPY_NOT_FOUND: "sharing:errors.copyNotFound",
  });
}

/**
 * The facts a refused undo names (`SHARE_UNDO_STALE` carries them in
 * `fields`, comma-separated) — so the message can say WHAT changed since.
 */
export function staleUndoFields(err: unknown): string[] {
  const data = (err as { response?: { data?: { code?: string; fields?: unknown } } } | null)
    ?.response?.data;
  if (data?.code !== "SHARE_UNDO_STALE" || typeof data.fields !== "string") return [];
  return data.fields.split(",").filter(Boolean);
}

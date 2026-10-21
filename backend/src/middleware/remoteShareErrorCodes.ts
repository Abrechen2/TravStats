/**
 * The error codes of trip sharing across servers (spec 2026-10-20 §7) —
 * `services/sharing/federation/`, raised through `remoteShareError()`. Part of `ApiErrorCode`
 * (`errorHandler.ts`), kept here so that list stays readable; the frontend maps each to DE/EN
 * copy (`components/sharing/remoteSharingCopy.ts`).
 */
export type RemoteShareApiErrorCode =
  | "SHARE_REMOTE_DISABLED"
  | "SHARE_REMOTE_INVITE_INVALID"
  | "SHARE_REMOTE_INVITE_WRONG_TAG"
  | "SHARE_REMOTE_INVITE_USED"
  | "SHARE_REMOTE_INVITE_EXPIRED"
  | "SHARE_REMOTE_INVITE_OWN_SERVER"
  | "SHARE_REMOTE_INVITE_LIMIT"
  | "SHARE_REMOTE_INVITE_NOT_FOUND"
  | "SHARE_REMOTE_DUPLICATE"
  /** `extra.origin` names the server the admin has not admitted. */
  | "SHARE_REMOTE_PEER_NOT_ADMITTED"
  | "SHARE_REMOTE_PEER_OUTDATED"
  | "SHARE_REMOTE_PEER_DISABLED"
  | "SHARE_REMOTE_UNREACHABLE"
  /** Offering a trip across servers (F-S4c); `_REFUSED` carries the other side's `extra.reason`. */
  | "SHARE_REMOTE_CONSENT_MISSING"
  | "SHARE_REMOTE_NOT_HOME"
  | "SHARE_REMOTE_ALREADY_MEMBER"
  | "SHARE_REMOTE_TRIP_TOO_LARGE"
  | "SHARE_REMOTE_PERSON_NOT_FOUND"
  | "SHARE_REMOTE_OFFER_NOT_FOUND"
  | "SHARE_REMOTE_REFUSED"
  | "SHARE_REMOTE_CONFLICT_STALE"
  /**
   * The lifecycle (F-S4e): nothing of the caller's on that trip waits for a confirmation; the
   * caller is not (or no longer) a member through any pairing; the trip's home is this server, so
   * it is offered from here, not asked for; no such person on the trip's roster.
   */
  | "SHARE_REMOTE_NOTHING_TO_CONFIRM"
  | "SHARE_REMOTE_NOT_MEMBER"
  | "SHARE_REMOTE_IS_HOME"
  | "SHARE_REMOTE_ROSTER_NOT_FOUND";

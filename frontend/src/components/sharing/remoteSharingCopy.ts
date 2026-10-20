import { saveErrorKey } from "../../lib/saveErrorMessage";

/**
 * The sentence a failed cross-server sharing action shows (spec 2026-10-20 §7): one per server
 * code, never the server's English. Where the sentence names the other server, its origin
 * comes from the refusal body (`origin`, sent beside `code`).
 */
const CODES: Readonly<Record<string, string>> = {
  SHARE_REMOTE_DISABLED: "sharing:remote.errors.disabled",
  SHARE_REMOTE_INVITE_INVALID: "sharing:remote.errors.inviteInvalid",
  SHARE_REMOTE_INVITE_WRONG_TAG: "sharing:remote.errors.wrongTag",
  SHARE_REMOTE_INVITE_USED: "sharing:remote.errors.used",
  SHARE_REMOTE_INVITE_EXPIRED: "sharing:remote.errors.expired",
  SHARE_REMOTE_INVITE_OWN_SERVER: "sharing:remote.errors.ownServer",
  SHARE_REMOTE_INVITE_LIMIT: "sharing:remote.errors.limit",
  SHARE_REMOTE_INVITE_NOT_FOUND: "sharing:remote.errors.inviteNotFound",
  SHARE_REMOTE_DUPLICATE: "sharing:remote.errors.duplicate",
  SHARE_REMOTE_PEER_NOT_ADMITTED: "sharing:remote.errors.notAdmitted",
  SHARE_REMOTE_PEER_OUTDATED: "sharing:remote.errors.outdated",
  SHARE_REMOTE_PEER_DISABLED: "sharing:remote.errors.peerDisabled",
  SHARE_REMOTE_UNREACHABLE: "sharing:remote.errors.unreachable",
};

export interface RemoteSharingError {
  key: string;
  /** The other server, when the refusal names one. */
  origin: string;
}

export function remoteSharingError(err: unknown, fallbackKey: string): RemoteSharingError {
  const data = (err as { response?: { data?: { origin?: unknown } } } | null)?.response?.data;
  return {
    key: saveErrorKey(err, fallbackKey, CODES),
    origin: typeof data?.origin === "string" ? data.origin : "",
  };
}

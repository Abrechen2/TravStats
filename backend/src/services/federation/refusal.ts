import { createHash } from "crypto";
import { AppError } from "../../middleware/errorHandler";

/**
 * Why a peer packet was turned away. The peer itself always reads the same 403 — it learns
 * nothing — but the operator's log names the kind, which one generic `refused()` never did.
 * Shared by every server-to-server protocol, so the message names none of them: the log line
 * of the route that refused says which protocol it was.
 */
export type PeerRefusalKind =
  | "beta-off"
  | "packet-too-large"
  | "malformed"
  | "unknown-peer"
  | "bad-signature"
  | "stale"
  | "unverified-peer"
  | "replay"
  | "unknown-channel"
  | "federation-off"
  // Envelope version 2 (spec 2026-10-20 §4): signed for the other protocol.
  | "wrong-purpose"
  // What an outgoing exchange met: 404, another status, no answer, a private DNS answer.
  | "remote-absent"
  | "remote-refused"
  | "unreachable"
  | "private-address"
  // Trip sharing across servers: not a member of the group, out of order, a stale precondition.
  | "not-member"
  | "gap"
  | "conflict"
  | "refused";

export class PeerRefusal extends AppError {
  kind: PeerRefusalKind;
  constructor(kind: PeerRefusalKind) {
    super("Peer request refused", 403);
    this.kind = kind;
    this.name = "PeerRefusal";
  }
}

/** `refused()` without a kind is the E2E code path's spelling and stays valid. */
export const refused = (kind: PeerRefusalKind = "refused"): PeerRefusal => new PeerRefusal(kind);
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

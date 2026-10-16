import { createHash } from "crypto";
import { AppError } from "../../middleware/errorHandler";

/**
 * Why a peer packet was turned away. The peer itself always reads the same 403 — it learns
 * nothing — but the operator's log names the kind, which one generic `refused()` never did.
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
  | "refused";

export class PeerRefusal extends AppError {
  kind: PeerRefusalKind;
  constructor(kind: PeerRefusalKind) {
    super("Comparison request refused", 403);
    this.kind = kind;
    this.name = "PeerRefusal";
  }
}

/** `refused()` without a kind is the E2E code path's spelling and stays valid. */
export const refused = (kind: PeerRefusalKind = "refused"): PeerRefusal => new PeerRefusal(kind);
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

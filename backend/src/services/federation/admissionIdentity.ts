/**
 * Reading another server's public identity before anyone pins it (spec 2026-11-07 §6.2). The
 * fetch goes through `fetchPublic`, so it has the egress check, the pinned address, no redirects
 * and a size and time cap of every other outbound peer request. The answer is untrusted: the
 * origin it states must be the origin asked, and the fingerprint must be the hash of the key.
 */
import { federationIdentityResponseSchema } from "../../schemas/federationAdmission";
import { COMPARISON_ACCEPTS } from "./envelope";
import { lanPeersEnabled } from "./peerAddressPolicy";
import { pemFromRawPublicKey } from "./rawKey";
import { hash, PeerRefusal } from "./refusal";
import { fetchPublic, type PeerTransport } from "./security";
import { admissionError } from "./admissionErrors";

const IDENTITY_TRANSPORT: PeerTransport = {
  path: "/api/v1/federation/identity",
  method: "GET",
  maxRequest: 0,
  maxReply: 4_096,
  budgetMs: 5_000,
  accepts: COMPARISON_ACCEPTS,
  beforeVerification: () => false,
};

export interface PeerIdentity {
  origin: string;
  /** SPKI PEM, the text the fingerprint is hashed from. */
  publicKey: string;
  fingerprint: string;
}

/** The identity `origin` publishes, or a named refusal. Never stores anything. */
export async function fetchPeerIdentity(origin: string): Promise<PeerIdentity> {
  let raw: Buffer;
  try {
    raw = await fetchPublic(origin, IDENTITY_TRANSPORT);
  } catch (error) {
    throw admissionError(
      "FEDERATION_ADMISSION_UNREACHABLE",
      502,
      "That server's identity could not be read",
      { origin, kind: error instanceof PeerRefusal ? error.kind : "error" }
    );
  }
  let parsed;
  try {
    parsed = federationIdentityResponseSchema.parse(JSON.parse(raw.toString()));
  } catch {
    throw admissionError("FEDERATION_ADMISSION_UNREACHABLE", 502, "Not a TravStats identity", {
      origin,
      kind: "malformed",
    });
  }
  const publicKey = pemFromRawPublicKey(parsed.publicKey);
  if (parsed.origin !== origin || !publicKey || hash(publicKey) !== parsed.fingerprint)
    throw admissionError(
      "FEDERATION_ADMISSION_KEY_MISMATCH",
      409,
      "That server's identity does not describe itself consistently",
      { origin }
    );
  return { origin, publicKey, fingerprint: parsed.fingerprint };
}

/**
 * Whether a redeem leaves the identity read to the admin's approval. With the LAN opt-in on, an
 * origin may name a private address, and a user's redeem must never make this server fetch from
 * one (Codex 11): the fetch happens when the admin approves.
 */
export const deferIdentityFetch = (): boolean => lanPeersEnabled();

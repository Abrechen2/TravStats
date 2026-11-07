/**
 * An Ed25519 public key as the 32 raw bytes (base64url) that the identity endpoint and an
 * invitation link carry, and back to the SPKI PEM whose hash is the fingerprint everywhere else.
 */
import { createPublicKey } from "crypto";
import { hash } from "./refusal";
import { parsePeerPublicKey } from "./peerKey";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const RAW_BYTES = 32;

/** The 32 raw bytes of a PEM public key, base64url; null when it is not an Ed25519 key. */
export function rawPublicKey(pem: string): string | null {
  const normal = parsePeerPublicKey(pem);
  if (!normal) return null;
  const der = createPublicKey(normal).export({ type: "spki", format: "der" });
  return der.subarray(der.length - RAW_BYTES).toString("base64url");
}

/** The SPKI PEM for 32 raw base64url bytes, or null when the text is not exactly that. */
export function pemFromRawPublicKey(raw: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== RAW_BYTES) return null;
  try {
    return parsePeerPublicKey(
      createPublicKey({
        key: Buffer.concat([SPKI_ED25519_PREFIX, bytes]),
        format: "der",
        type: "spki",
      })
        .export({ type: "spki", format: "pem" })
        .toString()
    );
  } catch {
    return null;
  }
}

export const fingerprintOfRaw = (raw: string): string | null => {
  const pem = pemFromRawPublicKey(raw);
  return pem ? hash(pem) : null;
};

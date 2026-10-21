/**
 * The signed envelope two admitted servers exchange, shared by every server-to-server protocol
 * (comparison, trip sharing). Protocol-neutral on purpose: this file imports no protocol's body
 * schema, so a protocol can use the crypto without reaching the other protocol's contract.
 *
 * Version 2 (spec 2026-10-20 §4) adds `purpose` to the SIGNED fields. A packet signed for the
 * leaderboard can therefore never verify on the trip-share route and vice versa, even if the two
 * body schemas ever came to overlap. Version 1 has no purpose; only the comparison route still
 * reads it, so a peer that predates version 2 keeps working for one release.
 */
import { createPublicKey, randomBytes, sign, verify, type KeyObject } from "crypto";
import { z } from "zod";
import { refused } from "./refusal";

export const origin = z
  .string()
  .max(250)
  .refine((v) => {
    if (v === "local") return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.origin === v && !u.username && !u.password && !u.port;
    } catch {
      return false;
    }
  });

export const ENVELOPE_PURPOSES = ["comparison/1", "trip-share/1"] as const;
export type EnvelopePurpose = (typeof ENVELOPE_PURPOSES)[number];

const signedFields = {
  origin,
  destination: origin,
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  time: z.number().int(),
  body: z.string().max(8_000_000),
  signature: z.string().max(100),
};
export const envelopeV1 = z.strictObject(signedFields);
export const envelopeV2 = z.strictObject({
  v: z.literal(2),
  purpose: z.enum(ENVELOPE_PURPOSES),
  ...signedFields,
});
export const signedEnvelope = z.union([envelopeV2, envelopeV1]);
export type Envelope = z.infer<typeof signedEnvelope>;
export type UnsignedEnvelope =
  Omit<z.infer<typeof envelopeV1>, "signature"> | Omit<z.infer<typeof envelopeV2>, "signature">;

/**
 * The exact bytes a signature covers. Built field by field in a fixed order rather than from
 * whatever object came in, so the bytes cannot depend on key order or on extra keys. Version 1's
 * bytes are byte-for-byte what every server before version 2 signs.
 */
export function signingBytes(e: UnsignedEnvelope): Buffer {
  const common = {
    origin: e.origin,
    destination: e.destination,
    nonce: e.nonce,
    time: e.time,
    body: e.body,
  };
  return Buffer.from(JSON.stringify("v" in e ? { v: 2, purpose: e.purpose, ...common } : common));
}

/** Which envelopes a route or a reply reader takes. */
export interface Acceptance {
  purpose: EnvelopePurpose;
  /** Whether a version-1 envelope (no purpose) is read as this purpose. */
  legacyV1: boolean;
}
export const COMPARISON_ACCEPTS: Acceptance = { purpose: "comparison/1", legacyV1: true };
export const TRIP_SHARE_ACCEPTS: Acceptance = { purpose: "trip-share/1", legacyV1: false };

const admits = (e: Envelope, accepts: Acceptance): boolean =>
  "v" in e ? e.purpose === accepts.purpose : accepts.legacyV1;

/** Signs `body` for `destination`; with a purpose as version 2, without one as version 1. */
export function envelope(
  body: unknown,
  destination: string,
  local: { origin: string; key: KeyObject },
  nonce = randomBytes(32).toString("hex"),
  purpose?: EnvelopePurpose
): Envelope {
  const fields = {
    origin: local.origin,
    destination,
    nonce,
    time: Date.now(),
    body: JSON.stringify(body),
  };
  const unsigned: UnsignedEnvelope = purpose ? { v: 2, purpose, ...fields } : fields;
  const signature = sign(null, signingBytes(unsigned), local.key).toString("base64");
  return { ...unsigned, signature };
}

/**
 * Parses, checks destination, clock window, signature and purpose — in that order, so a
 * `wrong-purpose` in the log always means the peer really signed a packet of the other protocol.
 */
export function verifyEnvelope(
  value: unknown,
  publicKey: string,
  destination: string,
  now = Date.now(),
  accepts: Acceptance = COMPARISON_ACCEPTS
): Envelope {
  const parsed = signedEnvelope.parse(value);
  const { signature, ...unsigned } = parsed;
  if (parsed.destination !== destination) throw refused("bad-signature");
  if (Math.abs(parsed.time - now) > 300_000) throw refused("stale");
  try {
    const key = createPublicKey(publicKey);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(null, signingBytes(unsigned), key, Buffer.from(signature, "base64"))
    )
      throw refused("bad-signature");
  } catch {
    throw refused("bad-signature");
  }
  if (!admits(parsed, accepts)) throw refused("wrong-purpose");
  return parsed;
}

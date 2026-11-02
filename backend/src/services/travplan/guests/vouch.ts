/**
 * The vouch: a guest's own server states, signed with its pinned Ed25519 key, that one of its
 * accounts is who the host's invitation was meant for (spec 2026-10-17 §6.5 step 3, D4).
 *
 * It carries identity and nothing else - the guest's server never sees a byte of the plan. The
 * bytes a signature covers are built field by field in a fixed order behind a domain prefix, so a
 * signature made for anything else (a comparison envelope, a trip-share packet) can never verify
 * as a vouch, and a vouch can never verify as one of them. Test vectors in `vouch.test.ts`.
 */
import { createHmac, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { origin } from "../../federation/envelope";

export const VOUCH_PREFIX = "travstats-vouch/1\n";
/** A vouch lives two minutes at most: it is redirected through the browser, nothing more. */
export const VOUCH_MAX_LIFETIME_S = 120;
const CLOCK_SKEW_S = 60;

export const vouchSchema = z.strictObject({
  v: z.literal(1),
  iss: origin,
  aud: origin,
  sub: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().min(1).max(100),
  invite: z.string().uuid(),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type Vouch = z.infer<typeof vouchSchema>;

/** Canonical JSON: this key order, no whitespace. The only form a signature is ever made over. */
export function canonicalVouch(v: Vouch): string {
  return JSON.stringify({
    v: 1,
    iss: v.iss,
    aud: v.aud,
    sub: v.sub,
    name: v.name,
    invite: v.invite,
    nonce: v.nonce,
    iat: v.iat,
    exp: v.exp,
  });
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The per-host pseudonym of one account: stable for that host, unlinkable across hosts. */
export function vouchSubject(key: KeyObject, host: string, userId: string): string {
  const secret = key.export({ type: "pkcs8", format: "der" });
  return createHmac("sha256", secret).update(`vouch-sub/1|${host}|${userId}`).digest("hex");
}

export function signVouch(v: Vouch, key: KeyObject): string {
  const canonical = canonicalVouch(vouchSchema.parse(v));
  const signature = sign(null, Buffer.from(VOUCH_PREFIX + canonical), key);
  return `${b64(canonical)}.${b64(signature)}`;
}

export type VouchFault =
  "malformed" | "bad-signature" | "wrong-audience" | "wrong-issuer" | "expired" | "too-long";

export class VouchRefused extends Error {
  constructor(public readonly fault: VouchFault) {
    super(`vouch refused: ${fault}`);
  }
}

/**
 * Reads a token WITHOUT trusting it, to learn which server claims to have issued it (so the
 * caller can look that server's pin up). Nothing in the result is believed until `verifyVouch`.
 */
export function claimedIssuer(token: string): string {
  return decode(token).vouch.iss;
}

function decode(token: string): { vouch: Vouch; canonical: string; signature: Buffer } {
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 2000) throw new VouchRefused("malformed");
  try {
    const canonical = Buffer.from(parts[0], "base64url").toString("utf8");
    const vouch = vouchSchema.parse(JSON.parse(canonical));
    // Only the canonical spelling verifies: another encoding of the same facts is a refusal.
    if (canonicalVouch(vouch) !== canonical) throw new VouchRefused("malformed");
    return { vouch, canonical, signature: Buffer.from(parts[1], "base64url") };
  } catch (error) {
    if (error instanceof VouchRefused) throw error;
    throw new VouchRefused("malformed");
  }
}

/** Signature by the PINNED key of the issuer, then audience and the clock window. */
export function verifyVouch(
  token: string,
  pinnedPublicKey: string,
  host: string,
  nowMs = Date.now()
): Vouch {
  const { vouch, canonical, signature } = decode(token);
  let valid = false;
  try {
    const key = createPublicKey(pinnedPublicKey);
    valid =
      key.asymmetricKeyType === "ed25519" &&
      verify(null, Buffer.from(VOUCH_PREFIX + canonical), key, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new VouchRefused("bad-signature");
  if (vouch.aud !== host) throw new VouchRefused("wrong-audience");
  if (vouch.exp - vouch.iat > VOUCH_MAX_LIFETIME_S) throw new VouchRefused("too-long");
  const now = Math.floor(nowMs / 1000);
  if (vouch.exp < now || vouch.iat > now + CLOCK_SKEW_S) throw new VouchRefused("expired");
  return vouch;
}

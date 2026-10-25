/**
 * The neutral keys of location evidence (TravTrack plan E1; review focus 18).
 *
 * A fix is identified by its whole second and its exact coordinates — the key
 * Dawarich dedups on and TravTrack's `positionKey` — so the same fix has the
 * same key whether it was read from Dawarich, from TravTrack, or copied from
 * one into the other. Numeric provider ids never enter a key.
 *
 * What is stored is never the key itself: a point digest and a stay's
 * evidence key are HMACs under a server secret derived from the instance key,
 * so a stored row cannot be turned back into a position, and the digests of
 * one account do not match another's. Digests are sensitive: never in an API
 * response, an export, a log or a share.
 */
import crypto from "crypto";

import { deriveInstanceSecret, deriveSecretFrom } from "../../utils/encryptionKey";
import type { KeyedObservation } from "./types";

/** The HKDF label of the evidence secret. Changing it re-keys every stored digest. */
export const EVIDENCE_SECRET_LABEL = "travtrack-evidence-digest";

/** Bytes a point digest keeps of its HMAC. */
const DIGEST_BYTES = 16;

/** Dawarich's and TravTrack's position key: whole second, longitude, latitude. */
export function observationKey(o: KeyedObservation): string {
  return `${Math.floor(o.atMs / 1000)}|${o.lon}|${o.lat}`;
}

/** The evidence secret for a given instance key (64 hex characters). */
export function evidenceSecretFrom(instanceKeyHex: string): Buffer {
  return deriveSecretFrom(instanceKeyHex, EVIDENCE_SECRET_LABEL);
}

let instanceSecret: Buffer | null = null;
function evidenceSecret(): Buffer {
  instanceSecret ??= deriveInstanceSecret(EVIDENCE_SECRET_LABEL);
  return instanceSecret;
}

const hmac = (secret: Buffer, parts: readonly (string | number)[]) =>
  crypto.createHmac("sha256", secret).update(JSON.stringify(parts)).digest();

/** A point's digest under `secret`, per account. */
export function pointDigestWith(secret: Buffer, userId: string, key: string): string {
  return hmac(secret, ["point", userId, key]).subarray(0, DIGEST_BYTES).toString("hex");
}

/** A point's digest under this instance's evidence secret. */
export function pointDigest(userId: string, key: string): string {
  return pointDigestWith(evidenceSecret(), userId, key);
}

/** A stay as the key sees it: its first and last fix, its bounds and its centre. */
export type StayKeyInput = {
  first: KeyedObservation;
  last: KeyedObservation;
  startMs: number;
  endMs: number;
  lat: number;
  lon: number;
};

/** A stay's provider-neutral evidence key under `secret`. */
export function stayEvidenceKeyWith(secret: Buffer, c: StayKeyInput): string {
  return hmac(secret, [
    "stay",
    observationKey(c.first),
    observationKey(c.last),
    c.startMs,
    c.endMs,
    c.lat.toFixed(5),
    c.lon.toFixed(5),
  ]).toString("hex");
}

/**
 * A stay's provider-neutral evidence key — stored in `evidence_key` for both
 * providers, and for TravTrack rows also the fingerprint. Dawarich rows keep
 * the fingerprint they always had.
 */
export function stayEvidenceKey(c: StayKeyInput): string {
  return stayEvidenceKeyWith(evidenceSecret(), c);
}

/** A country question's evidence key under `secret`: the country and its run's first day. */
export function countryEvidenceKeyWith(
  secret: Buffer,
  countryCode: string,
  firstDay: string
): string {
  return hmac(secret, ["country", countryCode, firstDay]).toString("hex");
}

/** A country question's provider-neutral evidence key (E6), under this instance's secret. */
export function countryEvidenceKey(countryCode: string, firstDay: string): string {
  return countryEvidenceKeyWith(evidenceSecret(), countryCode, firstDay);
}

/** A journey question's evidence key under `secret`: its local day and its first run's first fix. */
export function journeyEvidenceKeyWith(secret: Buffer, day: string, firstKey: string): string {
  return hmac(secret, ["journey", day, firstKey]).toString("hex");
}

/** A journey question's provider-neutral evidence key (E7), under this instance's secret. */
export function journeyEvidenceKey(day: string, firstKey: string): string {
  return journeyEvidenceKeyWith(evidenceSecret(), day, firstKey);
}

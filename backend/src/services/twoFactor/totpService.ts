import { createGuardrails, generateSecret as otpGenerateSecret, generateURI, verifySync } from "otplib";
import { encrypt, decrypt } from "../../utils/encryption";

// One step (30s) of tolerance either side. Phone clocks drift; two steps would
// double the guessing window for no practical gain. otplib 13 takes this in
// SECONDS (`epochTolerance`), where 12 took it in steps (`window: 1`).
const STEP_SECONDS = 30;
const EPOCH_TOLERANCE_SECONDS = STEP_SECONDS;

// otplib 12's generateSecret() wrote 10-byte secrets (16 base32 characters),
// and every account that enrolled before the 13 upgrade holds one. otplib 13
// refuses anything under 16 bytes by default — SecretTooShortError, which
// verifyCode's catch would turn into a plain "wrong code" and lock every one
// of those accounts out of its own login. The floor is lowered to what 12
// wrote; new secrets come from 13's own default (20 bytes) and are unaffected.
const LEGACY_SECRET_BYTES = 10;
const guardrails = createGuardrails({ MIN_SECRET_BYTES: LEGACY_SECRET_BYTES });

export function generateSecret(): string {
  return otpGenerateSecret();
}

export function buildOtpauthUrl(secret: string, username: string, issuer: string): string {
  return generateURI({ issuer, label: username, secret });
}

/** The secret is a credential: it never sits in the database in the clear. */
export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptSecret(stored: string): string {
  return decrypt(stored);
}

/**
 * Verify a code against a PLAINTEXT secret. Whitespace is stripped because
 * authenticator apps display codes as "123 456" and people copy them that way.
 */
export function verifyCode(secret: string, code: string): boolean {
  const normalised = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalised)) return false;
  try {
    return verifySync({ secret, token: normalised, epochTolerance: EPOCH_TOLERANCE_SECONDS, guardrails }).valid;
  } catch {
    return false;
  }
}

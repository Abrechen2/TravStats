import { authenticator } from "otplib";
import { encrypt, decrypt } from "../../utils/encryption";

// One step (30s) of tolerance either side. Phone clocks drift; two steps would
// double the guessing window for no practical gain.
authenticator.options = { window: 1 };

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(secret: string, username: string, issuer: string): string {
  return authenticator.keyuri(username, issuer, secret);
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
    return authenticator.verify({ token: normalised, secret });
  } catch {
    return false;
  }
}

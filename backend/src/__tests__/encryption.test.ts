import { describe, it, expect } from "@jest/globals";
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptApiKey,
  decryptApiKey,
} from "../utils/encryption";

/**
 * Regression coverage for the short-secret decryption bug (smoke-test S2).
 *
 * AES-256-GCM ciphertext is the same length as its plaintext, so a secret
 * shorter than 16 bytes used to decode to < 112 bytes and `isEncrypted()`
 * wrongly reported it as plaintext. `decryptApiKey()` then returned the
 * *ciphertext verbatim* — which callers sent upstream as the API key.
 */
describe("encryption round-trip across secret lengths", () => {
  // 1..15 are the previously-broken window (< 16-byte plaintext);
  // 16..128 always worked. All must round-trip after the fix.
  const lengths = [1, 3, 8, 14, 15, 16, 17, 32, 41, 128];

  it.each(lengths)("decryptApiKey(encryptApiKey(secret)) === secret for a %d-byte secret", (len) => {
    const secret = "k".repeat(len);
    const stored = encryptApiKey(secret);
    expect(stored).not.toBeNull();
    // The stored value must NOT be the plaintext — it must actually be encrypted.
    expect(stored).not.toBe(secret);
    expect(decryptApiKey(stored)).toBe(secret);
  });

  it("recognises every ciphertext it produces as encrypted", () => {
    for (const len of lengths) {
      const secret = "s".repeat(len);
      expect(isEncrypted(encrypt(secret))).toBe(true);
    }
  });
});

describe("decryptApiKey compatibility guarantees", () => {
  it("passes a legacy plaintext value through unchanged", () => {
    // A short, non-ciphertext-shaped plaintext must survive verbatim.
    expect(decryptApiKey("plain-legacy-key")).toBe("plain-legacy-key");
    expect(decryptApiKey("short")).toBe("short");
  });

  it("does not double-encrypt an already-encrypted value", () => {
    for (const len of [1, 8, 15, 16, 41]) {
      const secret = "d".repeat(len);
      const once = encryptApiKey(secret);
      const twice = encryptApiKey(once);
      // encryptApiKey must be idempotent on ciphertext, and the value must
      // still decrypt back to the ORIGINAL plaintext (not to ciphertext).
      expect(twice).toBe(once);
      expect(decryptApiKey(twice)).toBe(secret);
    }
  });

  it("returns null for a tampered ciphertext instead of garbage", () => {
    const stored = encrypt("k".repeat(20));
    // Flip a byte deep in the ciphertext region (past salt+iv+tag).
    const buf = Buffer.from(stored, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    const result = decryptApiKey(tampered);
    // Must never return the tampered ciphertext as if it were a valid key.
    expect(result).not.toBe(tampered);
    expect(result).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(decryptApiKey(null)).toBeNull();
    expect(decryptApiKey(undefined)).toBeNull();
    expect(decryptApiKey("")).toBeNull();
  });
});

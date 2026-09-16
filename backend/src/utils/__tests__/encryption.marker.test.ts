import { encryptApiKey, decryptApiKey, isEncrypted, isMarkedCiphertext } from '../encryption';

/**
 * A secret that looks like ciphertext is still a secret.
 *
 * `isEncrypted` is a guess — long enough, and base64-decodes to enough bytes.
 * A 200-character hex API token satisfies both, so `encryptApiKey` concluded it
 * was already encrypted and returned it untouched: the key went into the
 * database in the clear, and `decryptApiKey` then handed back null because the
 * value was not ciphertext after all. The provider read as unconfigured while
 * the secret sat unprotected (audit finding AUD-014).
 *
 * No tightening of that guess can be right; some plaintext will always look
 * like ciphertext. New values carry a marker and are asked, not guessed.
 */
const LONG_HEX_KEY = 'a1b2c3d4'.repeat(25); // 200 chars — the shape that fooled it

describe('encryption marker', () => {
  it('is a value the old heuristic would have mistaken for ciphertext', () => {
    // If this ever stops being true, the test below proves nothing — the whole
    // finding was about a plaintext that passes `isEncrypted`.
    expect(LONG_HEX_KEY.length).toBeGreaterThan(100);
    expect(isEncrypted(LONG_HEX_KEY)).toBe(true);
  });

  it('encrypts a long key instead of storing it in the clear', () => {
    const stored = encryptApiKey(LONG_HEX_KEY);

    expect(stored).not.toBeNull();
    expect(stored).not.toBe(LONG_HEX_KEY);
    expect(stored).not.toContain(LONG_HEX_KEY);
    expect(isMarkedCiphertext(stored!)).toBe(true);
  });

  it('gives the key back on the way out', () => {
    const stored = encryptApiKey(LONG_HEX_KEY);
    expect(decryptApiKey(stored)).toBe(LONG_HEX_KEY);
  });

  it.each([
    ['a short key', 'sk-1234567890'],
    ['a JWT-shaped value', 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.' + 'x'.repeat(120)],
    ['a base64-shaped value', Buffer.from('x'.repeat(150)).toString('base64')],
  ])('round-trips %s', (_label, value) => {
    const stored = encryptApiKey(value);
    expect(stored).not.toBe(value);
    expect(decryptApiKey(stored)).toBe(value);
  });

  it('does not double-encrypt a value it already produced', () => {
    const once = encryptApiKey(LONG_HEX_KEY);
    const twice = encryptApiKey(once);

    expect(twice).toBe(once);
    expect(decryptApiKey(twice)).toBe(LONG_HEX_KEY);
  });

  it('still reads a value stored before the marker existed', () => {
    // Rows written by earlier releases carry the bare base64 payload. Stripping
    // the marker from a freshly written value reproduces exactly that shape.
    const legacy = encryptApiKey(LONG_HEX_KEY)!.replace('tsenc:v1:', '');

    expect(isMarkedCiphertext(legacy)).toBe(false);
    expect(decryptApiKey(legacy)).toBe(LONG_HEX_KEY);
  });
});

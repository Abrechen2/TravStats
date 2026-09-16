import { createGuardrails, generateSync } from "otplib";
import {
  generateSecret,
  buildOtpauthUrl,
  encryptSecret,
  decryptSecret,
  verifyCode,
} from "../totpService";

describe("totpService", () => {
  it("generates a base32 secret an authenticator app accepts", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  });

  it("accepts the code the algorithm currently produces", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, generateSync({ secret }))).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, "000000")).toBe(false);
  });

  // A phone clock is never exactly the server's. One step either side is the
  // usual tolerance; more than that widens the window an attacker can guess in.
  //
  // otplib 13 takes the clock as `epoch` in SECONDS on each call — there is no
  // shared singleton to pin any more (otplib 12 merged an epoch into one and
  // could never unset it again, which is why this file once went through
  // `.clone()`).
  it("accepts the previous and next step, but not two steps away", () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const at = (offsetSeconds: number): string => generateSync({ secret, epoch: now + offsetSeconds });
    expect(verifyCode(secret, at(-30))).toBe(true);
    expect(verifyCode(secret, at(30))).toBe(true);
    expect(verifyCode(secret, at(-120))).toBe(false);
  });

  it("survives a code with spaces, which is how people copy it", () => {
    const secret = generateSecret();
    const code = generateSync({ secret });
    expect(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it("round-trips a secret through encryption", () => {
    const secret = generateSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("builds an otpauth URL carrying issuer and account", () => {
    const url = buildOtpauthUrl("JBSWY3DPEHPK3PXP", "alex", "TravStats");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("issuer=TravStats");
    expect(url).toContain("alex");
  });

  // Secrets enrolled under otplib 12 are RFC 4648 base32 and must keep
  // verifying after the 13 rewrite. RFC 6238's SHA-1 vector pins the decoder
  // and the HMAC path: ASCII "12345678901234567890" in base32, at epoch 59.
  // …and 12 wrote SHORT ones: 10 bytes, under 13's default 16-byte floor.
  it("still accepts the 10-byte secrets otplib 12 enrolled", () => {
    const legacy = "JBSWY3DPEHPK3PXP";
    // The generator side has the same floor, so the test must lower it too;
    // the service under test must NOT need telling.
    const code = generateSync({ secret: legacy, guardrails: createGuardrails({ MIN_SECRET_BYTES: 10 }) });
    expect(verifyCode(legacy, code)).toBe(true);
  });

  it("still reads an RFC 4648 base32 secret the way otplib 12 wrote it", () => {
    const rfc6238 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(generateSync({ secret: rfc6238, epoch: 59 })).toBe("287082");
  });
});

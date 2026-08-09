import { authenticator } from "otplib";
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
    expect(verifyCode(secret, authenticator.generate(secret))).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, "000000")).toBe(false);
  });

  // A phone clock is never exactly the server's. One step either side is the
  // usual tolerance; more than that widens the window an attacker can guess in.
  //
  // otplib takes the time from `authenticator.options.epoch`, NOT from a second
  // argument to generate() — passing one there is silently ignored and the test
  // would prove nothing. Setting `authenticator.options.epoch` directly does not
  // work either: the setter MERGES into the shared singleton's options rather
  // than replacing them, so an `epoch` written there can never be "unset" again
  // by assigning back an object that lacks the key — it stays pinned for the
  // rest of the process, silently judging every later `verifyCode` call in this
  // file against a frozen clock instead of `Date.now()`. `.clone(options)`
  // returns an independent instance with the override applied, touching nothing
  // on `authenticator` itself, so the singleton (and its `{ window: 1 }` from
  // totpService) stays untouched.
  it("accepts the previous and next step, but not two steps away", () => {
    const secret = generateSecret();
    const now = Date.now();
    const at = (offsetSeconds: number): string =>
      authenticator.clone({ epoch: now + offsetSeconds * 1000 }).generate(secret);
    expect(verifyCode(secret, at(-30))).toBe(true);
    expect(verifyCode(secret, at(30))).toBe(true);
    expect(verifyCode(secret, at(-120))).toBe(false);
  });

  it("survives a code with spaces, which is how people copy it", () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);
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
});

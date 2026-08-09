import {
  activateTwoFactorSchema,
  verifyTwoFactorSchema,
  disableTwoFactorSchema,
} from "../twoFactor";

describe("two-factor schemas", () => {
  it("accepts a six-digit activation code", () => {
    expect(activateTwoFactorSchema.parse({ code: "123456" }).code).toBe("123456");
  });

  it("rejects anything that is not six digits", () => {
    expect(() => activateTwoFactorSchema.parse({ code: "12345" })).toThrow();
    expect(() => activateTwoFactorSchema.parse({ code: "abcdef" })).toThrow();
  });

  it("strips the space authenticator apps display before validating", () => {
    expect(activateTwoFactorSchema.parse({ code: "123 456" }).code).toBe("123456");
  });

  it("takes either a code or a recovery code at login, but not neither", () => {
    expect(verifyTwoFactorSchema.parse({ code: "123456" }).code).toBe("123456");
    expect(verifyTwoFactorSchema.parse({ recoveryCode: "abcde-12345" }).recoveryCode).toBe(
      "abcde-12345",
    );
    expect(() => verifyTwoFactorSchema.parse({})).toThrow();
  });

  it("strips whitespace from the code on the login path too", () => {
    expect(verifyTwoFactorSchema.parse({ code: "123 456" }).code).toBe("123456");
  });

  it("allows both a code and a recovery code together — the handler picks", () => {
    const result = verifyTwoFactorSchema.parse({ code: "123456", recoveryCode: "abcde-12345" });
    expect(result.code).toBe("123456");
    expect(result.recoveryCode).toBe("abcde-12345");
  });

  it("requires the current password to switch it off", () => {
    expect(disableTwoFactorSchema.parse({ password: "hunter2" }).password).toBe("hunter2");
    expect(() => disableTwoFactorSchema.parse({})).toThrow();
  });
});

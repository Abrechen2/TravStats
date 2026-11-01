import { describe, expect, it } from "vitest";
import { secondFactorField } from "../secondFactorInput";

describe("secondFactorField", () => {
  it("sends six digits as an authenticator code, with or without spaces", () => {
    expect(secondFactorField("123456")).toEqual({ code: "123456" });
    expect(secondFactorField(" 123 456 ")).toEqual({ code: "123456" });
  });
  it("sends anything else as a backup code, so a user without the phone can still confirm", () => {
    expect(secondFactorField("aaaaa-11111")).toEqual({ recoveryCode: "aaaaa-11111" });
  });
  it("sends nothing for an empty field", () => {
    expect(secondFactorField("  ")).toEqual({});
  });
});

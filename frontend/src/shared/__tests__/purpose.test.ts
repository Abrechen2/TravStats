import { describe, it, expect } from "vitest";
import { isHiddenByPurpose, purposeFromTripCategory } from "../purpose";

/** The truth table; backend/src/shared/__tests__/purpose.test.ts asserts the same. */
describe("shared/purpose", () => {
  it.each([
    ["business", "business"],
    ["vacation", "private"],
    ["weekend", "private"],
    ["family", "private"],
    ["other", null],
    [null, null],
    [undefined, null],
    ["anything-new", null],
  ])("a trip category %s gives %s", (category, expected) => {
    expect(purposeFromTripCategory(category as string | null | undefined)).toBe(expected);
  });

  it("hides only what is named, and never an unknown purpose", () => {
    expect(isHiddenByPurpose("business", ["business"])).toBe(true);
    expect(isHiddenByPurpose("private", ["business"])).toBe(false);
    expect(isHiddenByPurpose(null, ["business", "private"])).toBe(false);
    expect(isHiddenByPurpose(undefined, ["business"])).toBe(false);
    expect(isHiddenByPurpose("business", undefined)).toBe(false);
  });
});

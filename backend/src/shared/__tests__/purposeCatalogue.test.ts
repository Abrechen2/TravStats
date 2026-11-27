import {
  BUILTIN_PURPOSES,
  effectivePurposeKey,
  parsePurposeKey,
  purposeKeyFromTripCategory,
} from "../purposeCatalogue";

/** Mirrored at frontend/src/shared/__tests__/purposeCatalogue.test.ts — same truth table. */
describe("purpose catalogue", () => {
  it("has ten built-ins, each with a kind; exactly two are business", () => {
    expect(BUILTIN_PURPOSES).toHaveLength(10);
    expect(BUILTIN_PURPOSES.filter((p) => p.kind === "business").map((p) => p.key)).toEqual([
      "business",
      "trade_fair",
    ]);
  });

  it("maps the legacy values: business -> Geschäftlich, private -> Privat (sonstiges)", () => {
    expect(parsePurposeKey("business")).toEqual({ type: "legacy", kind: "business" });
    expect(effectivePurposeKey("business", null)).toBe("builtin:business");
    expect(effectivePurposeKey("private", null)).toBe("builtin:private_other");
    expect(effectivePurposeKey(null, null)).toBeNull();
  });

  it("reads built-in and custom keys and refuses anything else", () => {
    expect(parsePurposeKey("builtin:trade_fair")).toEqual({
      type: "builtin",
      key: "builtin:trade_fair",
      kind: "business",
    });
    const id = "0b9f6c1e-1d2a-4f3b-9c8d-7e6f5a4b3c2d";
    expect(parsePurposeKey(`custom:${id}`)).toEqual({ type: "custom", key: `custom:${id}`, id });
    for (const bad of ["builtin:nope", "custom:not-a-uuid", "vacation", "", 3, null]) {
      expect(parsePurposeKey(bad)).toBeNull();
    }
  });

  it("a detail whose kind no longer matches the stored kind is stale and gives way", () => {
    expect(effectivePurposeKey("private", "builtin:trade_fair")).toBe("builtin:private_other");
    const id = "0b9f6c1e-1d2a-4f3b-9c8d-7e6f5a4b3c2d";
    expect(effectivePurposeKey("business", `custom:${id}`, () => "business")).toBe(`custom:${id}`);
    expect(effectivePurposeKey("business", `custom:${id}`, () => "private")).toBe(
      "builtin:business"
    );
    expect(effectivePurposeKey("business", `custom:${id}`)).toBe("builtin:business");
  });

  it("a trip category suggests the matching detail", () => {
    expect(purposeKeyFromTripCategory("vacation")).toBe("builtin:vacation");
    expect(purposeKeyFromTripCategory("weekend")).toBe("builtin:short_break");
    expect(purposeKeyFromTripCategory("family")).toBe("builtin:family_friends");
    expect(purposeKeyFromTripCategory("business")).toBe("builtin:business");
    expect(purposeKeyFromTripCategory("other")).toBeNull();
  });
});

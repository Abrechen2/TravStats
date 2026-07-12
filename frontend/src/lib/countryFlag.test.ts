import { describe, it, expect } from "vitest";
import { countryFlag } from "./countryFlag";

describe("countryFlag", () => {
  it("maps ISO-2 to a regional-indicator emoji", () => {
    expect(countryFlag("DE")).toBe("🇩🇪");
    expect(countryFlag("us")).toBe("🇺🇸");
  });

  it("returns null for invalid input", () => {
    expect(countryFlag(null)).toBeNull();
    expect(countryFlag("")).toBeNull();
    expect(countryFlag("DEU")).toBeNull();
    expect(countryFlag("1A")).toBeNull();
  });
});

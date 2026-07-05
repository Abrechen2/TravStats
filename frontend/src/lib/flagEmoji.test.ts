import { describe, it, expect } from "vitest";
import { flagEmoji, flagFromUnlocode } from "./flagEmoji";

describe("flagEmoji", () => {
  it("maps ISO alpha-2 codes to the flag emoji", () => {
    expect(flagEmoji("DE")).toBe("🇩🇪");
    expect(flagEmoji("US")).toBe("🇺🇸");
    expect(flagEmoji("AE")).toBe("🇦🇪");
  });

  it("is case-insensitive and trims", () => {
    expect(flagEmoji("de")).toBe("🇩🇪");
    expect(flagEmoji("  Us ")).toBe("🇺🇸");
  });

  it("returns empty string for invalid input", () => {
    expect(flagEmoji("")).toBe("");
    expect(flagEmoji(null)).toBe("");
    expect(flagEmoji(undefined)).toBe("");
    expect(flagEmoji("D")).toBe("");
    expect(flagEmoji("DEU")).toBe("");
    expect(flagEmoji("D1")).toBe("");
  });
});

describe("flagFromUnlocode", () => {
  it("uses the ISO country prefix of the LOCODE", () => {
    expect(flagFromUnlocode("DEHAM")).toBe("🇩🇪");
    expect(flagFromUnlocode("ITCVV")).toBe("🇮🇹");
    expect(flagFromUnlocode("ESBCN")).toBe("🇪🇸");
  });

  it("returns empty string for missing / short codes", () => {
    expect(flagFromUnlocode(null)).toBe("");
    expect(flagFromUnlocode("D")).toBe("");
  });
});

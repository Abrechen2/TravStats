import { describe, it, expect } from "vitest";
import { countryFromUnlocode, flagImgHtml, resolveCountryCode } from "./countryFlag";

describe("countryFromUnlocode", () => {
  it("takes the ISO prefix of the LOCODE, upper-cased", () => {
    expect(countryFromUnlocode("DEHAM")).toBe("DE");
    expect(countryFromUnlocode("itcvv")).toBe("IT");
  });
  it("returns undefined for missing / non-letter prefixes", () => {
    expect(countryFromUnlocode(null)).toBeUndefined();
    expect(countryFromUnlocode("1XABC")).toBeUndefined();
    expect(countryFromUnlocode("D")).toBeUndefined();
  });
});

describe("flagImgHtml", () => {
  it("builds a flagcdn img tag for a valid code", () => {
    const html = flagImgHtml("DE");
    expect(html).toContain("https://flagcdn.com/de.svg");
    expect(html).toMatch(/^<img /);
  });
  it("is case-insensitive", () => {
    expect(flagImgHtml("gr")).toContain("flagcdn.com/gr.svg");
  });
  it("returns empty string for invalid input", () => {
    expect(flagImgHtml(null)).toBe("");
    expect(flagImgHtml("")).toBe("");
    expect(flagImgHtml("DEU")).toBe("");
  });
  it("honours a custom height", () => {
    expect(flagImgHtml("US", 20)).toContain('height="20"');
  });
});

describe("resolveCountryCode", () => {
  it("passes an already-valid ISO code straight through, upper-cased", () => {
    expect(resolveCountryCode("ch")).toBe("CH");
    expect(resolveCountryCode("DE")).toBe("DE");
  });

  it("resolves a full country name in German or English to its ISO code", () => {
    expect(resolveCountryCode("Schweiz")).toBe("CH");
    expect(resolveCountryCode("Switzerland")).toBe("CH");
    expect(resolveCountryCode("Deutschland")).toBe("DE");
    expect(resolveCountryCode("Germany")).toBe("DE");
  });

  it("is case-insensitive for full names", () => {
    expect(resolveCountryCode("switzerland")).toBe("CH");
  });

  it("returns null (never a broken glyph) for unresolvable input", () => {
    expect(resolveCountryCode(null)).toBeNull();
    expect(resolveCountryCode("")).toBeNull();
    expect(resolveCountryCode("Nonexistentland")).toBeNull();
  });
});

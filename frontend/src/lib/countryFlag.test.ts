import { describe, it, expect } from "vitest";
import { countryFromUnlocode, flagImgHtml } from "./countryFlag";

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

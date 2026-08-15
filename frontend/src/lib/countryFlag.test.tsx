import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { countryFromUnlocode, FlagImg, flagImgHtml, resolveCountryCode } from "./countryFlag";

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

  // Measured on the real lodging data: 65 of 279 houses showed NO flag because
  // the field holds the country's name in its OWN language — which is what an
  // imported list or a foreign booking mail naturally carries.
  it("resolves a country name in its own language", () => {
    expect(resolveCountryCode("España")).toBe("ES");
    expect(resolveCountryCode("Italia")).toBe("IT");
    expect(resolveCountryCode("Sverige")).toBe("SE");
    expect(resolveCountryCode("Česko")).toBe("CZ");
    expect(resolveCountryCode("Slovenija")).toBe("SI");
    expect(resolveCountryCode("Lëtzebuerg")).toBe("LU");
    expect(resolveCountryCode("Nederland")).toBe("NL");
    expect(resolveCountryCode("România")).toBe("RO");
    expect(resolveCountryCode("Việt Nam")).toBe("VN");
    expect(resolveCountryCode("日本")).toBe("JP");
    expect(resolveCountryCode("中国")).toBe("CN");
    expect(resolveCountryCode("مصر")).toBe("EG");
  });

  // A multilingual country writes all its names into one field.
  it("resolves a field that carries several names at once", () => {
    expect(resolveCountryCode("Schweiz/Suisse/Svizzera/Svizra")).toBe("CH");
    expect(resolveCountryCode("België / Belgique / Belgien")).toBe("BE");
    expect(resolveCountryCode("Suomi / Finland")).toBe("FI");
    expect(resolveCountryCode("Madagasikara / Madagascar")).toBe("MG");
  });

  // Names Intl does not carry: former official forms and everyday variants.
  it("resolves well-known alternative names", () => {
    expect(resolveCountryCode("Tschechische Republik")).toBe("CZ");
    expect(resolveCountryCode("Czech Republic")).toBe("CZ");
    expect(resolveCountryCode("USA")).toBe("US");
  });

  it("returns null (never a broken glyph) for unresolvable input", () => {
    expect(resolveCountryCode(null)).toBeNull();
    expect(resolveCountryCode("")).toBeNull();
    expect(resolveCountryCode("Nonexistentland")).toBeNull();
  });

  // "null" arrives as literal text when an import writes a missing value as a
  // string. A flag for a country called "null" would be pure invention.
  it("refuses the strings 'null' and 'undefined'", () => {
    expect(resolveCountryCode("null")).toBeNull();
    expect(resolveCountryCode("undefined")).toBeNull();
  });
});

describe("flagImgHtml", () => {
  it("resolves a name too, so a globe tooltip is not the odd one out", () => {
    expect(flagImgHtml("Deutschland")).toContain("https://flagcdn.com/de.svg");
    expect(flagImgHtml("Nirgendwo")).toBe("");
  });
});

describe("FlagImg", () => {
  it("draws a flag for a country NAME, not only for a code", () => {
    // A lodging carries its country as a name — "Deutschland" from a booking
    // mail, whatever Google Places answers for the rest. Accepting only the
    // two-letter code left a whole hotel list flagless while the flight list,
    // fed by the airport catalogue, was fully flagged.
    const { container } = render(<FlagImg country="Deutschland" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flagcdn.com/de.svg");
  });

  it("still draws one for a plain code", () => {
    const { container } = render(<FlagImg country="ch" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flagcdn.com/ch.svg");
  });

  it("keeps the URL lowercase — flagcdn 404s on /DE.svg", () => {
    // `resolveCountryCode` upper-cases by design (it is an ISO code), so the
    // URL builder has to lower it again. Both call sites go through flagUrl.
    const { container } = render(<FlagImg country="Schweiz" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://flagcdn.com/ch.svg");
  });

  it("draws nothing at all when the country cannot be resolved", () => {
    const { container } = render(<FlagImg country="Nirgendwo" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

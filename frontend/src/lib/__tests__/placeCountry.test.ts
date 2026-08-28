import { describe, it, expect } from "vitest";
import { placeCountryLabel, placeCountryCode } from "../placeCountry";

/**
 * The defect this covers, found on a real RC: 49 of the owner's 54 places
 * showed "Land — AU". They came from the World Heritage catalogue, which
 * carries an ISO code for every entry and a country NAME for only 14 — so the
 * detail page printed an em dash for the missing name and the bare code beside
 * it, while the LIST page resolved the very same record correctly through its
 * own private copy of this logic.
 */
describe("placeCountryLabel", () => {
  it("resolves a place that has only an ISO code", () => {
    expect(placeCountryLabel({ country: null, isoCountryCode: "AU" }, "de")).toBe("Australien");
  });

  it("follows the app language", () => {
    expect(placeCountryLabel({ country: null, isoCountryCode: "AU" }, "en")).toBe("Australia");
  });

  it("prefers the code over stored text, so the name follows the language", () => {
    // The catalogue writes English names; a German UI should still read German.
    const place = { country: "Australia", isoCountryCode: "AU" };
    expect(placeCountryLabel(place, "de")).toBe("Australien");
  });

  it("falls back to the stored text when there is no code", () => {
    expect(placeCountryLabel({ country: "Freistaat Bayern", isoCountryCode: null }, "de")).toBe(
      "Freistaat Bayern",
    );
  });

  it("returns empty when the record holds neither", () => {
    expect(placeCountryLabel({ country: null, isoCountryCode: null }, "de")).toBe("");
  });

  it("shows a code that names no known region as itself", () => {
    // Measured, not assumed: Intl hands back unknown-but-well-formed codes
    // unchanged ("QQ"), while "ZZ" genuinely resolves to "Unbekannte Region".
    // Either way the reader gets something rather than a blank.
    expect(placeCountryLabel({ country: null, isoCountryCode: "QQ" }, "de")).toBe("QQ");
  });

  it("falls back to the raw code when Intl rejects the format outright", () => {
    // "A1" makes Intl throw; countryName swallows it and returns "", which is
    // exactly what the `||` in placeCountryLabel is there to catch.
    expect(placeCountryLabel({ country: null, isoCountryCode: "A1" }, "de")).toBe("A1");
  });
});

describe("placeCountryCode", () => {
  it("uses the stored code", () => {
    expect(placeCountryCode({ country: null, isoCountryCode: "JP" })).toBe("JP");
  });

  it("derives one from the country name when the code is missing", () => {
    // This is what makes the flag appear: the call sites used to guard on
    // `place.country` being truthy, so a code-only place drew no flag at all.
    expect(placeCountryCode({ country: "Japan", isoCountryCode: null })).toBe("JP");
  });

  it("returns null when neither half resolves", () => {
    expect(placeCountryCode({ country: null, isoCountryCode: null })).toBeNull();
  });
});

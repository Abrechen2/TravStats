import { describe, it, expect } from "@jest/globals";
import { formatStreetAddress } from "../streetAddress";

/**
 * Both geocoders joined street and house number in German order, unconditionally:
 *
 *   `${props.street} ${props.housenumber}`      (photon.ts)
 *   [road, houseNumber].join(" ")               (nominatim.ts)
 *
 * Correct for Germany, wrong for most of the English-speaking world. Found on
 * the owner's own data: "Hotel Rose" in Portland was stored as "Southwest
 * Morrison Street 50" instead of "50 Southwest Morrison Street", and four more
 * US entries alongside it.
 */

describe("formatStreetAddress", () => {
  it("puts the number last where the language does", () => {
    expect(formatStreetAddress("Kronenbergstrasse", "14", "de")).toBe("Kronenbergstrasse 14");
    expect(formatStreetAddress("Graf-Konrad-Straße", "5", "AT")).toBe("Graf-Konrad-Straße 5");
    expect(formatStreetAddress("Bahnhofstrasse", "1", "ch")).toBe("Bahnhofstrasse 1");
  });

  it("puts the number first where the language does", () => {
    expect(formatStreetAddress("Southwest Morrison Street", "50", "us")).toBe(
      "50 Southwest Morrison Street",
    );
    expect(formatStreetAddress("Oxford Street", "12", "GB")).toBe("12 Oxford Street");
    expect(formatStreetAddress("Rue de Rivoli", "7", "fr")).toBe("7 Rue de Rivoli");
    expect(formatStreetAddress("Queen Street", "3", "au")).toBe("3 Queen Street");
  });

  it("falls back to the street when there is no number", () => {
    expect(formatStreetAddress("Southwest Morrison Street", null, "us")).toBe(
      "Southwest Morrison Street",
    );
    expect(formatStreetAddress("Kronenbergstrasse", undefined, "de")).toBe("Kronenbergstrasse");
  });

  it("returns nothing when there is no street — a bare number is not an address", () => {
    expect(formatStreetAddress(null, "50", "us")).toBeUndefined();
    expect(formatStreetAddress(undefined, undefined, "de")).toBeUndefined();
  });

  it("defaults to street-first when the country is unknown", () => {
    // Most of Europe, and the geocoders' own default. Guessing the other way
    // round would break the majority of this catalogue to fix a minority.
    expect(formatStreetAddress("Hauptstrasse", "9", undefined)).toBe("Hauptstrasse 9");
    expect(formatStreetAddress("Hauptstrasse", "9", "")).toBe("Hauptstrasse 9");
    expect(formatStreetAddress("Hauptstrasse", "9", "xx")).toBe("Hauptstrasse 9");
  });
});

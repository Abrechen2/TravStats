import { describe, expect, it } from "vitest";
import { parseCoordinateInput } from "../coordinateParse";

/**
 * Exhaustive coverage of the parser contract from
 * `docs/superpowers/plans/2026-07-12-location-input-and-map-alignment.md`
 * ("Coordinate paste — 'viele Möglichkeiten'"). Every accepted form gets its
 * own test, plus every documented rejection.
 */
describe("parseCoordinateInput", () => {
  describe("accepted — decimal pairs with different separators", () => {
    it("parses a comma-separated pair (THE spec assertion — Zürich)", () => {
      expect(parseCoordinateInput("47.3769, 8.5417")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("parses a space-separated pair", () => {
      expect(parseCoordinateInput("47.3769 8.5417")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("parses a semicolon-separated pair", () => {
      expect(parseCoordinateInput("47.3769; 8.5417")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("parses a semicolon pair with no surrounding spaces", () => {
      expect(parseCoordinateInput("47.3769;8.5417")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("trims surrounding whitespace", () => {
      expect(parseCoordinateInput("  47.3769, 8.5417  ")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("parses negative coordinates (Sydney)", () => {
      expect(parseCoordinateInput("-33.8688, 151.2093")).toEqual({
        lat: -33.8688,
        lon: 151.2093,
      });
    });
  });

  describe("accepted — parentheses/brackets stripped", () => {
    it("strips surrounding parentheses", () => {
      expect(parseCoordinateInput("(47.3769, 8.5417)")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("strips surrounding square brackets", () => {
      expect(parseCoordinateInput("[47.3769, 8.5417]")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });
  });

  describe("accepted — Google Maps URL forms", () => {
    it("extracts lat/lon from the @lat,lon,zoom URL form", () => {
      expect(
        parseCoordinateInput(
          "https://www.google.com/maps/place/Z%C3%BCrich/@47.3769,8.5417,12z/data=!3m1!4b1"
        )
      ).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("extracts lat/lon from the ?q=lat,lon URL form", () => {
      expect(parseCoordinateInput("https://www.google.com/maps?q=47.3769,8.5417")).toEqual({
        lat: 47.3769,
        lon: 8.5417,
      });
    });

    it("extracts lat/lon from a &q=lat,lon URL form (query param not first)", () => {
      expect(
        parseCoordinateInput("https://maps.google.com/maps?ll=1,1&q=47.3769,8.5417&z=12")
      ).toEqual({ lat: 47.3769, lon: 8.5417 });
    });
  });

  describe("accepted — hemisphere letters", () => {
    it("parses trailing hemisphere letters (N/E, positive)", () => {
      expect(parseCoordinateInput("47.3769 N, 8.5417 E")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("parses leading hemisphere letters (N/E, positive)", () => {
      expect(parseCoordinateInput("N 47.3769 E 8.5417")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("negates for S/W hemisphere letters (trailing)", () => {
      expect(parseCoordinateInput("47.3769 S, 8.5417 W")).toEqual({
        lat: -47.3769,
        lon: -8.5417,
      });
    });

    it("negates for S/W hemisphere letters (leading)", () => {
      expect(parseCoordinateInput("S 47.3769 W 8.5417")).toEqual({
        lat: -47.3769,
        lon: -8.5417,
      });
    });

    it("accepts lowercase hemisphere letters", () => {
      expect(parseCoordinateInput("47.3769 n, 8.5417 e")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });

    it("is axis-order agnostic (lon/E first, lat/N second)", () => {
      expect(parseCoordinateInput("8.5417 E, 47.3769 N")).toEqual({ lat: 47.3769, lon: 8.5417 });
    });
  });

  describe("no auto-swap — never guess silently", () => {
    it("keeps positional lat/lon even when it reads like a swapped pair (both still in-range)", () => {
      // Zürich is (47.3769, 8.5417). Typed backwards as "8.5417, 47.3769" both
      // components are still individually in-range, so the parser must NOT
      // try to detect/fix the "more plausible" order — it takes the pair
      // literally: first = lat, second = lon.
      expect(parseCoordinateInput("8.5417, 47.3769")).toEqual({ lat: 8.5417, lon: 47.3769 });
    });

    it("rejects (does not swap into range) when the first component can't be a latitude", () => {
      // 95 is not a valid latitude. Swapping it into the longitude slot
      // (95, 47.3769 -> lat 47.3769 / lon 95) would "rescue" the input, but
      // the parser must never guess — it returns null instead.
      expect(parseCoordinateInput("95, 47.3769")).toBeNull();
    });
  });

  describe("rejected — out of range", () => {
    it("rejects an out-of-range latitude", () => {
      expect(parseCoordinateInput("200, 8.5417")).toBeNull();
    });

    it("rejects an out-of-range longitude", () => {
      expect(parseCoordinateInput("47.3769, 500")).toBeNull();
    });

    it("rejects an out-of-range hemisphere-annotated value", () => {
      expect(parseCoordinateInput("95 N, 8.5417 E")).toBeNull();
    });
  });

  describe("rejected — not a coordinate pair", () => {
    it("rejects a single number", () => {
      expect(parseCoordinateInput("47.3769")).toBeNull();
    });

    it("rejects free text", () => {
      expect(parseCoordinateInput("Hotel Adlon Berlin")).toBeNull();
    });

    it("rejects an empty string", () => {
      expect(parseCoordinateInput("")).toBeNull();
    });

    it("rejects a whitespace-only string", () => {
      expect(parseCoordinateInput("   ")).toBeNull();
    });
  });

  describe("rejected — DMS (documented follow-up, not implemented)", () => {
    it("rejects a full DMS pair", () => {
      expect(parseCoordinateInput(`47°22'37"N 8°32'30"E`)).toBeNull();
    });

    it("rejects a bare degree-symbol value", () => {
      expect(parseCoordinateInput("47.3769°, 8.5417°")).toBeNull();
    });
  });

  describe("rejected — Plus Codes (documented follow-up, not implemented)", () => {
    it("rejects a full Plus Code", () => {
      expect(parseCoordinateInput("8FVC9G8F+6X")).toBeNull();
    });

    it("rejects a locality-shortened Plus Code", () => {
      expect(parseCoordinateInput("9G8F+6X Zurich")).toBeNull();
    });
  });
});

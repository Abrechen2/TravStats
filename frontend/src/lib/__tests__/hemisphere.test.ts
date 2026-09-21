import { describe, expect, it } from "vitest";
import {
  formatLatitude,
  formatLongitude,
  latitudeHemisphere,
  longitudeHemisphere,
} from "../hemisphere";

/**
 * SRV-STATS-HEMISPHERE-001 (audit 2026-09-20): a purely northern logbook
 * labelled its southernmost airport, Bangkok at +13.68, as "13.68°S" — the
 * card's title had been taken for the coordinate's sign.
 */
describe("hemisphere", () => {
  it("calls a positive latitude north even when it is the southernmost one held", () => {
    expect(latitudeHemisphere(13.68)).toBe("N");
    expect(formatLatitude(13.68)).toBe("13.68° N");
  });

  it("calls a negative latitude south even when it is the northernmost one held", () => {
    expect(latitudeHemisphere(-33.95)).toBe("S");
    // The northernmost card used to print the raw signed number here.
    expect(formatLatitude(-33.95)).toBe("33.95° S");
  });

  it("puts the equator and the prime meridian on the positive side", () => {
    expect(formatLatitude(0)).toBe("0.00° N");
    expect(formatLongitude(0)).toBe("0.00° E");
  });

  it("reads longitude the same way", () => {
    expect(longitudeHemisphere(-0.45)).toBe("W");
    expect(formatLongitude(-118.24)).toBe("118.24° W");
    expect(formatLongitude(151.21)).toBe("151.21° E");
  });

  it("takes the number of decimals from the caller", () => {
    expect(formatLatitude(69.9726, 1)).toBe("70.0° N");
    expect(formatLatitude(69.9726, 0)).toBe("70° N");
  });
});

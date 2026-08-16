import { describe, it, expect } from "@jest/globals";
import { metresBetween, findNearbyLodgings } from "../proximityMatch";

/**
 * The import matcher goes externalRef -> name+city -> name. It never compares
 * coordinates, so two records for one house survive whenever the names differ
 * by a decoration:
 *
 *   "Hotel Fortuna"              (from a booking mail, carries the stay)
 *   "Hotel - Restaurant Fortuna" (from the saved-places export)
 *
 * Measured on the owner's library: 25 such pairs among 293 houses — and in 24
 * of them the two records sit on the SAME coordinate. That is the signal the
 * matcher was throwing away.
 */

const bietigheim = { id: "a", lat: 48.9608777, lon: 9.1291715 };
const portland = { id: "b", lat: 45.5173559, lon: -122.67327 };

describe("metresBetween", () => {
  it("is zero for the same point", () => {
    expect(metresBetween(48.96, 9.13, 48.96, 9.13)).toBe(0);
  });

  it("measures a short hop in metres", () => {
    // 0.001° of latitude is ~111 m anywhere on Earth.
    expect(metresBetween(48.96, 9.13, 48.961, 9.13)).toBeGreaterThan(100);
    expect(metresBetween(48.96, 9.13, 48.961, 9.13)).toBeLessThan(120);
  });

  it("does not confuse two continents", () => {
    expect(
      metresBetween(bietigheim.lat, bietigheim.lon, portland.lat, portland.lon),
    ).toBeGreaterThan(8_000_000);
  });

  it("accounts for longitude converging towards the poles", () => {
    // A degree of longitude is ~111 km at the equator and ~73 km at 49° N.
    const atEquator = metresBetween(0, 0, 0, 1);
    const atFortyNine = metresBetween(49, 0, 49, 1);
    expect(atFortyNine).toBeLessThan(atEquator * 0.75);
  });
});

describe("findNearbyLodgings", () => {
  const stored = [
    { id: "fortuna", lat: 48.9608777, lon: 9.1291715 },
    { id: "far-away", lat: 52.52, lon: 13.405 },
    { id: "no-pin", lat: null, lon: null },
  ];

  it("finds the house on the same spot under a different name", () => {
    const hits = findNearbyLodgings(stored, 48.9608777, 9.1291715, 150);
    expect(hits.map((h) => h.id)).toEqual(["fortuna"]);
  });

  it("still finds it a few dozen metres off — a pin is not surveying", () => {
    const hits = findNearbyLodgings(stored, 48.9612, 9.1294, 150);
    expect(hits.map((h) => h.id)).toEqual(["fortuna"]);
  });

  it("does not reach across the street to the hotel next door", () => {
    expect(findNearbyLodgings(stored, 48.965, 9.135, 150)).toEqual([]);
  });

  it("ignores stored rows that have no pin at all", () => {
    // A null coordinate must never read as 0/0 — that is a point in the
    // Atlantic, and everything without a pin would match everything else.
    expect(findNearbyLodgings(stored, 0, 0, 150)).toEqual([]);
  });

  it("has nothing to say when the incoming row has no coordinate", () => {
    expect(findNearbyLodgings(stored, null, null, 150)).toEqual([]);
  });
});

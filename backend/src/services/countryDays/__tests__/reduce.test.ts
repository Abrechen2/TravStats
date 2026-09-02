/**
 * The reduction is the privacy boundary, so these tests pin two things at once:
 * that it counts correctly, and that what it hands back holds no position.
 */
import { describe, it, expect } from "@jest/globals";

import { reduceToCountryDays, type TimedPosition } from "../reduce";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MARCH_3 = Date.UTC(2026, 2, 3);

/** Estonia in the north, Latvia in the south — a stand-in for the boundary
 *  index, so no 10 MB file is read to test arithmetic. */
const countryAt = (lat: number, lon: number): string | null => {
  if (lon < 0) return null; // "the sea": the resolver's abstention
  return lat >= 58 ? "EE" : "LV";
};

const at = (timestampMs: number, latitude: number, longitude: number): TimedPosition => ({
  timestampMs,
  latitude,
  longitude,
});

describe("reduceToCountryDays", () => {
  it("groups by UTC day and country, counting the points that attested each", () => {
    const days = reduceToCountryDays(
      [
        at(MARCH_3 + 8 * HOUR_MS, 59.4, 24.7),
        at(MARCH_3 + 9 * HOUR_MS, 59.5, 24.8),
        at(MARCH_3 + 20 * HOUR_MS, 56.9, 24.1),
        at(MARCH_3 + DAY_MS + HOUR_MS, 56.95, 24.15),
      ],
      countryAt,
    );

    expect(days.map(({ date, countryCode, pointCount }) => ({ date, countryCode, pointCount }))).toEqual(
      [
        { date: "2026-03-03", countryCode: "EE", pointCount: 2 },
        { date: "2026-03-03", countryCode: "LV", pointCount: 1 },
        { date: "2026-03-04", countryCode: "LV", pointCount: 1 },
      ],
    );
  });

  /**
   * The whole point of the module: what comes back is a day, a code and three
   * scalars. A caller cannot reconstruct where anybody was, which is what makes
   * the table safe to keep and safe to read.
   */
  it("returns no coordinate of any kind", () => {
    const [row] = reduceToCountryDays([at(MARCH_3, 59.4, 24.7)], countryAt);

    expect(Object.keys(row).sort()).toEqual([
      "airportPointCount",
      "countryCode",
      "date",
      "pointCount",
      "spanKm",
    ]);
    expect(JSON.stringify(row)).not.toContain("59.4");
    expect(JSON.stringify(row)).not.toContain("24.7");
  });

  it("drops a point the resolver abstains on rather than guessing a country", () => {
    const days = reduceToCountryDays(
      [at(MARCH_3, 59.4, -30), at(MARCH_3, 59.4, 24.7)],
      countryAt,
    );

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ countryCode: "EE", pointCount: 1 });
  });

  /**
   * `spanKm` is what §3.4c's `transited` rung will need — points spread across
   * a country versus points sitting at one airport — and it must be derivable
   * from the row alone, because the points are gone.
   */
  it("measures how far apart the day's points were, zero for a single fix", () => {
    const [single] = reduceToCountryDays([at(MARCH_3, 59.4, 24.7)], countryAt);
    expect(single.spanKm).toBe(0);

    const [spread] = reduceToCountryDays(
      [at(MARCH_3, 59.0, 24.0), at(MARCH_3, 59.9, 26.0)],
      countryAt,
    );
    // ~1° of latitude plus 2° of longitude at this latitude.
    expect(spread.spanKm).toBeGreaterThan(100);
    expect(spread.spanKm).toBeLessThan(200);
  });

  it("has nothing to say about a window with no usable point", () => {
    expect(reduceToCountryDays([], countryAt)).toEqual([]);
    expect(reduceToCountryDays([at(Number.NaN, 59.4, 24.7)], countryAt)).toEqual([]);
  });
});

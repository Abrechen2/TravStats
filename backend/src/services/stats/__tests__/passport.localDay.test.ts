/**
 * forgejo#273 — the passport files a flight's airports and years on the day
 * the loader read at the DEPARTURE airport (`PassportFlight.localDay`), the
 * same day its spells and ground days already use. The touch loop read the
 * stored instant's UTC day and year instead, so a Tokyo departure at 07:30
 * on 1 January was a stamp of the previous year, and a New York departure
 * late on 31 December one of the next.
 */
import { describe, it, expect } from "@jest/globals";

import { buildPassport, type PassportFlight } from "../passport";

const COUNTRIES = new Map<string, string | null>([
  ["NRT", "JP"],
  ["HND", "JP"],
  ["JFK", "US"],
  ["LAX", "US"],
  ["MUC", "DE"],
]);

const AT: Record<string, { lat: number; lon: number }> = {
  NRT: { lat: 35.7647, lon: 140.3863 },
  HND: { lat: 35.5494, lon: 139.7798 },
  JFK: { lat: 40.6413, lon: -73.7781 },
  LAX: { lat: 33.9416, lon: -118.4085 },
  MUC: { lat: 48.3538, lon: 11.7861 },
};

const flight = (
  dep: string,
  arr: string,
  departureTime: string,
  localDay: string | null
): PassportFlight => ({
  depIata: dep,
  depLat: AT[dep].lat,
  depLon: AT[dep].lon,
  arrIata: arr,
  arrLat: AT[arr].lat,
  arrLon: AT[arr].lon,
  departureTime: new Date(departureTime),
  status: "flown",
  localDay,
});

const NOW = new Date("2026-08-29T00:00:00Z");

describe("buildPassport — years and first visits on the departure airport's day", () => {
  it("files a Tokyo departure at 07:30 on 1 January under the new year", () => {
    // 07:30 JST on 2026-01-01 is 22:30Z on 2025-12-31.
    const p = buildPassport(
      [flight("NRT", "MUC", "2025-12-31T22:30:00Z", "2026-01-01")],
      COUNTRIES,
      [],
      NOW
    );
    const japan = p.countries.find((c) => c.code === "JP");
    expect(japan?.firstYear).toBe(2026);
    expect(japan?.lastYear).toBe(2026);
    expect(p.summary.firstStampYear).toBe(2026);
  });

  it("files a New York departure late on 31 December under the old year", () => {
    // 22:00 EST on 2025-12-31 is 03:00Z on 2026-01-01.
    const p = buildPassport(
      [flight("JFK", "MUC", "2026-01-01T03:00:00Z", "2025-12-31")],
      COUNTRIES,
      [],
      NOW
    );
    expect(p.countries.find((c) => c.code === "US")?.lastYear).toBe(2025);
  });

  it("orders a country's airports by their local first-visit day", () => {
    // HND on 2 September at 07:30 local (22:30Z on the 1st) came AFTER NRT on
    // 1 September at 20:00 local (11:00Z). By UTC day both are the 1st and
    // the alphabet put HND first.
    const p = buildPassport(
      [
        flight("HND", "MUC", "2026-09-01T22:30:00Z", "2026-09-02"),
        flight("NRT", "MUC", "2026-09-01T11:00:00Z", "2026-09-01"),
      ],
      COUNTRIES,
      [],
      NOW
    );
    expect(p.countries.find((c) => c.code === "JP")?.airports).toEqual(["NRT", "HND"]);
  });

  it("falls back to the stored day when the caller resolved none", () => {
    // No local day (an airport with no zone on file): the stored components,
    // the same fallback `localWallClockOf` makes.
    const p = buildPassport(
      [flight("LAX", "MUC", "2026-01-01T03:00:00Z", null)],
      COUNTRIES,
      [],
      NOW
    );
    expect(p.countries.find((c) => c.code === "US")?.firstYear).toBe(2026);
  });
});

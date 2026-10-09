/**
 * forgejo#273 — a DATE_ONLY flight is filed on the day the user recorded,
 * whatever its airport's zone. The row stores 12:00Z of that day; read through
 * a zone at UTC+12 or beyond (Auckland, Suva/Nadi, Kiritimati) the placeholder
 * is already the next local day, and the busiest day, the top year and the
 * countries-by-year all moved the flight with it. Timed flights keep their
 * local reading — the fix is about the placeholder, not the zone.
 */
import { calculateFunStats } from "../funStats";
import { computeCountryStats } from "../../../services/stats/countryStats";
import type { FlightData } from "../types";

jest.mock("../../../services/airportCache", () => ({
  getCachedAirports: jest.fn(
    async () =>
      new Map([
        ["AKL", { country: "New Zealand", timezone: "Pacific/Auckland" }],
        ["NAN", { country: "Fiji", timezone: "Pacific/Fiji" }],
        ["SYD", { country: "Australia", timezone: "Australia/Sydney" }],
      ])
  ),
}));

function flight(
  depIata: string,
  arrIata: string,
  stored: string,
  depTimezone: string,
  semantics: "DATE_ONLY" | "UTC"
): FlightData {
  return {
    id: `${depIata}-${arrIata}-${stored}`,
    status: semantics === "DATE_ONLY" ? "historical" : "flown",
    depIata,
    arrIata,
    depIcao: null,
    arrIcao: null,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    departureTime: new Date(stored),
    arrivalTime: new Date(stored),
    depTimezone,
    depTimeSemantics: semantics,
    createdAt: new Date(),
  };
}

describe("fun stats: a date-only flight east of UTC+12 keeps its recorded day", () => {
  it("files the busiest day on the recorded date, not the next one", async () => {
    // Two date-only flights recorded on 30 June from Auckland and Nadi, one
    // timed flight from Sydney that genuinely left on 1 July local. Read
    // through the zone, all three landed on 1 July; the recorded days say
    // 30 June twice.
    const stats = await calculateFunStats([
      flight("AKL", "SYD", "2020-06-30T12:00:00Z", "Pacific/Auckland", "DATE_ONLY"),
      flight("NAN", "AKL", "2020-06-30T12:00:00Z", "Pacific/Fiji", "DATE_ONLY"),
      flight("SYD", "AKL", "2020-06-30T15:00:00Z", "Australia/Sydney", "UTC"), // 01:00 1 July
    ]);
    expect(stats.fastestDay).toBe("2020-06-30");
    expect(stats.fastestDayFlights).toBe(2);
  });

  it("files a New Year's Eve date-only flight under the year it was recorded in", async () => {
    const stats = await calculateFunStats([
      flight("AKL", "SYD", "2025-12-31T12:00:00Z", "Pacific/Auckland", "DATE_ONLY"),
      flight("AKL", "SYD", "2025-12-30T12:00:00Z", "Pacific/Auckland", "DATE_ONLY"),
      flight("SYD", "AKL", "2026-03-01T01:00:00Z", "Australia/Sydney", "UTC"),
    ]);
    expect(stats.milestoneYear).toBe(2025);
    expect(stats.milestoneYearFlights).toBe(2);
  });
});

describe("country stats: a date-only flight east of UTC+12 keeps its recorded year", () => {
  it("lists New Zealand under 2025 for a flight recorded on 31 December 2025", async () => {
    const result = await computeCountryStats([
      {
        depIata: "AKL",
        depIcao: null,
        arrIata: "AKL",
        arrIcao: null,
        departureTime: new Date("2025-12-31T12:00:00Z"),
        depTimeSemantics: "DATE_ONLY",
      },
    ]);
    expect(Object.keys(result.byYear)).toEqual(["2025"]);
  });

  it("still reads a timed Auckland departure on the local clock", async () => {
    // 31 Dec 12:00Z is 1 Jan 01:00 NZDT: a real instant, so a real 2026.
    const result = await computeCountryStats([
      {
        depIata: "AKL",
        depIcao: null,
        arrIata: "AKL",
        arrIcao: null,
        departureTime: new Date("2025-12-31T12:00:00Z"),
        depTimeSemantics: "UTC",
      },
    ]);
    expect(Object.keys(result.byYear)).toEqual(["2026"]);
  });
});

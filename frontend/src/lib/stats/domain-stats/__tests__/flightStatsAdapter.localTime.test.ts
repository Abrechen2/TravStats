import { describe, it, expect } from "vitest";
import { adaptFlight } from "../flightStatsAdapter";
import type { Flight } from "../../../../types";

function makeFlight(overrides: Partial<Flight>): Flight {
  return {
    id: "f1",
    userId: "u1",
    airline: "Lufthansa",
    flightNumber: "LH400",
    depLat: 50.0379,
    depLon: 8.5622,
    arrLat: 40.6413,
    arrLon: -73.7781,
    departureTime: "2024-03-15T10:00:00Z",
    arrivalTime: "2024-03-15T18:00:00Z",
    status: "flown",
    createdAt: "2024-03-15T00:00:00Z",
    durationMinutes: 480,
    depTimeSemantics: "UTC",
    ...overrides,
  };
}

describe("adaptFlight buckets on the departure airport's clock (#266)", () => {
  it("files a late New York departure under the year it was flown", () => {
    // 22:30 on 31 December in New York is 03:30 on 1 January UTC. Read in the
    // browser's zone it could land in either year depending on who is looking.
    const stats = adaptFlight({
      flights: [
        makeFlight({
          departureTime: "2026-01-01T03:30:00Z",
          depTimezone: "America/New_York",
        }),
      ],
      countries: [],
    });

    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents[2025]).toBe(1);
    expect(stats.yearlyEvents[2026]).toBeUndefined();
  });

  it("counts a Monday departure in Tokyo as a Monday", () => {
    // Monday 00:30 in Tokyo is Sunday 15:30 UTC.
    const stats = adaptFlight({
      flights: [
        makeFlight({
          departureTime: "2026-07-05T15:30:00Z",
          depTimezone: "Asia/Tokyo",
        }),
      ],
      countries: [],
    });

    if (!stats.hasData) throw new Error("expected data");
    expect(stats.weekdayEvents[1]).toBe(1); // Monday
    expect(stats.weekdayEvents[0]).toBeUndefined(); // not Sunday
  });

  it("treats two departures on one local day as a single active day", () => {
    // Both leave Auckland on 15 March local, straddling midnight UTC.
    const stats = adaptFlight({
      flights: [
        makeFlight({
          id: "a",
          departureTime: "2026-03-14T20:00:00Z",
          depTimezone: "Pacific/Auckland",
        }),
        makeFlight({
          id: "b",
          departureTime: "2026-03-15T02:00:00Z",
          depTimezone: "Pacific/Auckland",
        }),
      ],
      countries: [],
    });

    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents[2026]).toBe(2);
    expect(stats.yearlyActiveDays[2026]).toBe(1);
  });

  it("does not shift a legacy fake-UTC row a second time", () => {
    const stats = adaptFlight({
      flights: [
        makeFlight({
          departureTime: "2020-01-01T02:00:00Z",
          depTimezone: "Pacific/Auckland",
          depTimeSemantics: "LEGACY_FAKE_UTC",
        }),
      ],
      countries: [],
    });

    // The stored components already read 1 January locally. Converting them
    // through Auckland would push the flight into 2020-01-01T15:00 — same
    // year here, but the date and weekday would be wrong.
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents[2020]).toBe(1);
    expect(stats.weekdayEvents[3]).toBe(1); // Wednesday, 1 Jan 2020
  });
});

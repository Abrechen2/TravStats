import { describe, it, expect } from "@jest/globals";

import {
  computeRailJourneyFigures,
  isDocumentedTransferJourney,
  railJourneysOf,
  type RailJourneyRow,
} from "../railJourneyStats";

/**
 * forgejo#261 — journeys, changes, connections, punctuality and nights on
 * board, over rides the counting rule already admitted.
 */
const STATIONS = {
  koeln: { id: 1, name: "Köln Hbf", code: "8000207", lat: 50.9432, lon: 6.9586 },
  frankfurt: { id: 2, name: "Frankfurt (Main) Hbf", code: "8000105", lat: 50.1071, lon: 8.6632 },
  basel: { id: 4, name: "Basel SBB", code: "8500010", lat: 47.5476, lon: 7.5897 },
  wien: { id: 5, name: "Wien Hbf", code: "8103000", lat: 48.185, lon: 16.3769 },
  hamburg: { id: 6, name: "Hamburg Hbf", code: "8002549", lat: 53.553, lon: 10.0069 },
} as const;
type Key = keyof typeof STATIONS;

let seq = 0;
function ride(
  from: Key,
  to: Key,
  departure: string,
  arrival: string | null,
  over: Partial<RailJourneyRow> = {}
): RailJourneyRow {
  seq += 1;
  const dep = STATIONS[from];
  const arr = STATIONS[to];
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    travelClass: null,
    depStationName: dep.name,
    arrStationName: arr.name,
    depStationCode: dep.code,
    arrStationCode: arr.code,
    depStationId: dep.id,
    arrStationId: arr.id,
    depLat: dep.lat,
    depLon: dep.lon,
    arrLat: arr.lat,
    arrLon: arr.lon,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Berlin",
    departureTime: new Date(departure),
    arrivalTime: arrival ? new Date(arrival) : null,
    depPrecision: "minute",
    arrPrecision: "minute",
    delayMinutes: null,
    bookingId: null,
    ...over,
  };
}

describe("rail journeys and changes", () => {
  it("reads two legs of one booking meeting at a station as ONE journey with one measured change", () => {
    const a = ride("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z", {
      bookingId: "b1",
    });
    const b = ride("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z", {
      bookingId: "b1",
    });
    const figures = computeRailJourneyFigures([a, b]);
    expect(figures.journeys).toEqual({ total: 1, withTransfer: 1 });
    expect(figures.transfers).toEqual({
      count: 1,
      averageMinutes: 15,
      shortestMinutes: 15,
      longestMinutes: 15,
    });
  });

  it("never joins rides that are not linked by a booking, however well they line up", () => {
    const a = ride("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z");
    const b = ride("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z");
    const figures = computeRailJourneyFigures([a, b]);
    expect(figures.journeys).toEqual({ total: 2, withTransfer: 0 });
    expect(figures.transfers.count).toBe(0);
    // No change measured is no figure — not a 0-minute change.
    expect(figures.transfers.averageMinutes).toBeNull();
  });

  it("splits an outbound and its return on one booking into two journeys", () => {
    const out = ride("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z", {
      bookingId: "b2",
    });
    const back = ride("frankfurt", "koeln", "2025-03-01T09:00Z", "2025-03-01T10:05Z", {
      bookingId: "b2",
    });
    expect(computeRailJourneyFigures([out, back]).journeys).toEqual({
      total: 2,
      withTransfer: 0,
    });
  });

  it("calls a journey with a change documented only when every train carries both clocks", () => {
    const a = ride("koeln", "frankfurt", "2025-03-01T07:00Z", "2025-03-01T08:05Z", {
      bookingId: "b3",
    });
    const b = ride("frankfurt", "basel", "2025-03-01T08:20Z", "2025-03-01T11:10Z", {
      bookingId: "b3",
    });
    const [journey] = railJourneysOf([a, b]);
    expect(isDocumentedTransferJourney(journey)).toBe(true);
    expect(isDocumentedTransferJourney([a])).toBe(false);
    expect(isDocumentedTransferJourney([a, { ...b, arrPrecision: "day" }])).toBe(false);
  });
});

describe("rail connections", () => {
  it("counts both directions as one favourite connection and leaves a single ride out", () => {
    const rides = [
      ride("koeln", "basel", "2024-01-01T07:00Z", "2024-01-01T11:00Z"),
      ride("basel", "koeln", "2024-01-05T07:00Z", "2024-01-05T11:00Z"),
      ride("koeln", "basel", "2025-01-01T07:00Z", "2025-01-01T11:00Z"),
      ride("koeln", "frankfurt", "2025-02-01T07:00Z", "2025-02-01T08:00Z"),
    ];
    const { favouriteConnections } = computeRailJourneyFigures(rides);
    expect(favouriteConnections).toHaveLength(1);
    expect(favouriteConnections[0]).toMatchObject({
      from: "Basel SBB",
      to: "Köln Hbf",
      rides: 3,
      latestRideId: rides[2].id,
    });
  });

  it("files a connection as new in the year of its FIRST ride, even when a year is on screen", () => {
    const first = ride("koeln", "basel", "2024-03-01T07:00Z", "2024-03-01T11:00Z");
    const again = ride("basel", "koeln", "2025-03-01T07:00Z", "2025-03-01T11:00Z");
    const fresh = ride("wien", "hamburg", "2025-04-01T07:00Z", "2025-04-01T18:00Z");
    const all = [first, again, fresh];
    const year2025 = computeRailJourneyFigures([again, fresh], all);
    expect(year2025.newConnections.inScope).toBe(1);
    expect(year2025.newConnections.byYear).toEqual([
      { year: 2024, count: 1 },
      { year: 2025, count: 1 },
    ]);
  });
});

describe("rail punctuality", () => {
  it("compares operators by their measured rides only — an unrecorded delay is never on time", () => {
    const rides = [
      ride("koeln", "basel", "2025-01-01T07:00Z", "2025-01-01T11:00Z", { delayMinutes: 0 }),
      ride("koeln", "basel", "2025-01-02T07:00Z", "2025-01-02T11:00Z", { delayMinutes: 20 }),
      ride("koeln", "basel", "2025-01-03T07:00Z", "2025-01-03T11:00Z", { delayMinutes: null }),
      ride("wien", "hamburg", "2025-01-04T07:00Z", "2025-01-04T18:00Z", {
        operator: "ÖBB",
        delayMinutes: -2,
      }),
      // A date-only ride has no clock to be late against.
      ride("wien", "hamburg", "2025-01-05T00:00Z", "2025-01-05T00:00Z", {
        operator: "ÖBB",
        delayMinutes: 30,
        depPrecision: "day",
        arrPrecision: "day",
      }),
    ];
    const { byOperator, byConnection } = computeRailJourneyFigures(rides).punctuality;
    expect(byOperator).toEqual([
      { label: "DB Fernverkehr", measured: 2, onTime: 1, averageMinutes: 10 },
      { label: "ÖBB", measured: 1, onTime: 1, averageMinutes: -2 },
    ]);
    expect(byConnection.map((r) => [r.label, r.measured])).toEqual([
      ["Basel SBB – Köln Hbf", 2],
      ["Hamburg Hbf – Wien Hbf", 1],
    ]);
  });

  // Review M3: a ride with no arrival has no clock to be late against.
  it("leaves a delay on a ride without an arrival out of the sample", () => {
    const rides = [
      ride("koeln", "basel", "2025-01-01T07:00Z", null, { delayMinutes: 25, arrPrecision: null }),
    ];
    expect(computeRailJourneyFigures(rides).punctuality.byOperator).toEqual([]);
  });

  it("folds operator spellings into one row", () => {
    const rides = [
      ride("koeln", "basel", "2025-01-01T07:00Z", "2025-01-01T11:00Z", { delayMinutes: 5 }),
      ride("koeln", "basel", "2025-01-02T07:00Z", "2025-01-02T11:00Z", {
        operator: "db  fernverkehr",
        delayMinutes: 5,
      }),
    ];
    expect(computeRailJourneyFigures(rides).punctuality.byOperator).toEqual([
      { label: "DB Fernverkehr", measured: 2, onTime: 0, averageMinutes: 5 },
    ]);
  });
});

describe("nights on a night train", () => {
  it("counts the nights slept on board and the night trains no calendar can hold", () => {
    const nightjet = ride("wien", "hamburg", "2025-12-31T21:58Z", "2026-01-01T08:00Z", {
      trainCategory: "NJ",
      depTimezone: "Europe/Vienna",
    });
    const noArrival = ride("wien", "hamburg", "2025-06-01T20:00Z", null, {
      travelClass: "sleeper",
    });
    const day = ride("koeln", "basel", "2025-01-01T07:00Z", "2025-01-01T11:00Z");
    expect(computeRailJourneyFigures([nightjet, noArrival, day]).nightTrainNights).toEqual({
      nights: 1,
      undated: 1,
    });
  });
});

/**
 * Forgejo #255 — the sequence badges (Hat-Trick, Groundhog Day, There and Back
 * Again) take a flight's day from the DEPARTURE AIRPORT'S clock, the contract
 * every other "which day was that" figure reads. They used to cut the stored
 * instant at UTC midnight, so two Tokyo departures on one local day could be two
 * days, and a pair split by UTC midnight could miss a same-day return.
 */
import { computeFlightSequenceStats } from "../flightSequenceStats";
import type { FlightData } from "../achievementStats";

function flight(
  dep: string,
  arr: string,
  departure: string,
  over: Partial<FlightData> = {}
): FlightData {
  return {
    id: `${dep}-${arr}-${departure}`,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    depIcao: null,
    depIata: dep,
    arrIcao: null,
    arrIata: arr,
    airline: null,
    aircraft: null,
    flightNumber: null,
    seatNumber: null,
    seatClass: null,
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
    departureTime: new Date(departure),
    arrivalTime: null,
    depTimezone: "Asia/Tokyo",
    depTimeSemantics: "UTC",
    status: "flown",
    specialType: null,
    ...over,
  };
}

const nrtKix = (departure: string, over: Partial<FlightData> = {}) =>
  flight("NRT", "KIX", departure, over);

describe("Hat-Trick — flights on one LOCAL day", () => {
  it("joins departures either side of UTC midnight that share a Tokyo day", () => {
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T23:30:00Z"),
      nrtKix("2026-09-02T01:30:00Z"),
      nrtKix("2026-09-02T05:00:00Z"),
    ]);
    expect(stats.maxFlightsOneDay).toBe(3);
  });

  it("splits departures that share a UTC day but not a local day", () => {
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T10:00:00Z"),
      nrtKix("2026-09-01T16:00:00Z"),
    ]);
    expect(stats.maxFlightsOneDay).toBe(1);
  });

  it("reads a western departure on its own clock", () => {
    const jfk = (departure: string) =>
      flight("JFK", "BOS", departure, { depTimezone: "America/New_York" });
    // 16:00 and 21:30 EDT on 1 Sep, one UTC day apart.
    const stats = computeFlightSequenceStats([
      jfk("2026-09-01T20:00:00Z"),
      jfk("2026-09-02T01:30:00Z"),
    ]);
    expect(stats.maxFlightsOneDay).toBe(2);
  });

  it("takes the zone from the airport catalogue when the flight stored none", () => {
    const zones = new Map([["NRT", { timezone: "Asia/Tokyo" }]]);
    const stats = computeFlightSequenceStats(
      [
        nrtKix("2026-09-01T23:30:00Z", { depTimezone: null }),
        nrtKix("2026-09-02T01:30:00Z", { depTimezone: null }),
      ],
      zones
    );
    expect(stats.maxFlightsOneDay).toBe(2);
  });

  it("keeps a date-only flight on its recorded date", () => {
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-02T12:00:00Z", { depTimeSemantics: "DATE_ONLY", status: "historical" }),
      nrtKix("2026-09-01T23:30:00Z"),
    ]);
    expect(stats.maxFlightsOneDay).toBe(2);
  });

  it("falls back to the stored (UTC) day with no zone on file, as every other stat does", () => {
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T23:30:00Z", { depTimezone: null }),
      nrtKix("2026-09-02T01:30:00Z", { depTimezone: null }),
    ]);
    expect(stats.maxFlightsOneDay).toBe(1);
  });
});

describe("Groundhog Day — the same leg on consecutive LOCAL days", () => {
  it("counts three Tokyo days that UTC midnight splits unevenly", () => {
    // Local 2, 3 and 4 Sep; UTC days 1, 3 and 4 would not be consecutive.
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T16:00:00Z"),
      nrtKix("2026-09-03T00:00:00Z"),
      nrtKix("2026-09-04T00:00:00Z"),
    ]);
    expect(stats.groundhogRoute).toBe(3);
  });

  it("does not count a third day that is the same local day as the second", () => {
    // UTC days 1, 2 and 3 look consecutive; locally the first two are both 2 Sep.
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T23:30:00Z"),
      nrtKix("2026-09-02T01:30:00Z"),
      nrtKix("2026-09-03T01:30:00Z"),
    ]);
    expect(stats.groundhogRoute).toBe(2);
  });
});

describe("There and Back Again — out and back on one LOCAL day", () => {
  const back = (departure: string) =>
    flight("KIX", "NRT", departure, { depTimezone: "Asia/Tokyo" });

  it("recognises a return that UTC midnight separates from the outbound leg", () => {
    // Both on 2 Sep in Japan: 08:30 out, 18:00 back.
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T23:30:00Z"),
      back("2026-09-02T09:00:00Z"),
    ]);
    expect(stats.hasSameDayReturn).toBe(1);
  });

  it("does not count a return that is on the next local day", () => {
    // Same UTC day, but 19:00 on the 1st and 01:00 on the 2nd in Japan.
    const stats = computeFlightSequenceStats([
      nrtKix("2026-09-01T10:00:00Z"),
      back("2026-09-01T16:00:00Z"),
    ]);
    expect(stats.hasSameDayReturn).toBe(0);
  });
});

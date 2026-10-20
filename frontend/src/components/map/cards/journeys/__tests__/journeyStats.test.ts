import { describe, expect, it } from "vitest";
import {
  journeyFromBus,
  journeyFromFerry,
  journeyFromRail,
  journeyFromRental,
  journeyFromTripFlight,
} from "../journeyNormalize";
import {
  endKey,
  getJourneyRouteStats,
  getJourneyStopStats,
  journeyRouteKey,
  journeysOnRoute,
  latestJourney,
  sumJourneyDistance,
} from "../journeyStats";
import type { MapJourney } from "../journeyTypes";

const BERLIN = { depStationName: "Berlin Hbf", depLat: 52.525, depLon: 13.369 };
const MUNICH = { arrStationName: "München Hbf", arrLat: 48.14, arrLon: 11.558 };

function rail(over: Record<string, unknown> = {}): MapJourney {
  return journeyFromRail({
    id: "r1",
    status: "completed",
    ...BERLIN,
    ...MUNICH,
    departureTime: "2024-05-01T08:00:00Z",
    distanceKm: 584,
    operator: "DB Fernverkehr",
    ...over,
  } as Parameters<typeof journeyFromRail>[0]);
}

/** The same ride, the other way round. */
function railBack(over: Record<string, unknown> = {}): MapJourney {
  return journeyFromRail({
    id: "r2",
    status: "completed",
    depStationName: "München Hbf",
    depLat: 48.14,
    depLon: 11.558,
    arrStationName: "Berlin Hauptbahnhof",
    arrLat: 52.5251,
    arrLon: 13.3691,
    departureTime: "2024-06-01T08:00:00Z",
    distanceKm: 590,
    operator: "DB Fernverkehr",
    ...over,
  } as Parameters<typeof journeyFromRail>[0]);
}

describe("journey route identity", () => {
  it("is the unordered pair of the two places, as a flight connection is", () => {
    expect(journeyRouteKey(rail())).toBe(journeyRouteKey(railBack()));
  });

  it("treats two spellings of one station within ~100 m as one place", () => {
    expect(endKey(rail().dep)).toBe(endKey(railBack().arr));
  });

  it("aggregates every journey of the route and leaves cancelled ones out", () => {
    const all = [rail(), railBack(), railBack({ id: "r3", status: "cancelled" })];
    expect(journeysOnRoute(all, rail()).map((j) => j.id)).toEqual(["r1", "r2"]);
  });
});

describe("journey route stats", () => {
  it("sums known distances only, and names the unknown ones instead of adding 0", () => {
    const stats = getJourneyRouteStats([rail(), railBack({ distanceKm: null })]);
    expect(stats.knownKm).toBe(584);
    expect(stats.measuredCount).toBe(1);
    expect(stats.unknownCount).toBe(1);
  });

  it("reads a stored 0 km as unknown, not as a zero-length ride", () => {
    expect(sumJourneyDistance([rail({ distanceKm: 0 })])).toEqual({
      knownKm: 0,
      measuredCount: 0,
      unknownCount: 1,
    });
  });

  it("counts planned journeys apart and never adds their distance", () => {
    const stats = getJourneyRouteStats([
      rail(),
      railBack({ id: "r4", status: "scheduled", departureTime: "2030-01-01T08:00:00Z" }),
    ]);
    expect(stats.travelled).toBe(1);
    expect(stats.planned).toBe(1);
    expect(stats.knownKm).toBe(584);
  });

  it("names the last journey travelled, newest first in the list, and the top operator", () => {
    const stats = getJourneyRouteStats([
      rail(),
      railBack(),
      rail({ id: "r5", operator: "FlixTrain", departureTime: "2023-01-01T08:00:00Z" }),
    ]);
    expect(stats.latest).toEqual({
      journey: expect.objectContaining({ id: "r2" }),
      upcoming: false,
    });
    expect(stats.list.map((j) => j.id)).toEqual(["r2", "r1", "r5"]);
    expect(stats.topOperator).toBe("DB Fernverkehr");
  });

  it("names the nearest planned journey, flagged upcoming, when none has happened", () => {
    const latest = latestJourney([
      rail({ id: "a", status: "scheduled", departureTime: "2031-01-01T00:00:00Z" }),
      rail({ id: "b", status: "scheduled", departureTime: "2030-01-01T00:00:00Z" }),
    ]);
    expect(latest).toEqual({ journey: expect.objectContaining({ id: "b" }), upcoming: true });
  });
});

describe("journey stop stats", () => {
  it("counts every journey touching the station and names the most frequent connection", () => {
    const hamburg = rail({
      id: "h",
      arrStationName: "Hamburg Hbf",
      arrLat: 53.553,
      arrLon: 10.006,
    });
    const stats = getJourneyStopStats([rail(), railBack(), hamburg], endKey(rail().dep));
    expect(stats.travelled).toBe(3);
    expect(stats.topRoute).toEqual({ name: "München Hbf", count: 2 });
  });
});

describe("each domain's counting rule decides travelled vs planned", () => {
  const ends = { ...BERLIN, ...MUNICH };
  it.each([
    ["rail", journeyFromRail],
    ["bus", journeyFromBus],
    ["ferry", journeyFromFerry],
  ] as const)(
    "%s: completed is travelled, scheduled is planned, cancelled is neither",
    (_, from) => {
      const make = (status: string) =>
        (from as (row: unknown) => MapJourney)({ id: status, status, ...ends });
      expect(make("completed")).toMatchObject({ travelled: true, planned: false });
      expect(make("scheduled")).toMatchObject({ travelled: false, planned: true });
      expect(make("in_progress")).toMatchObject({ travelled: false, planned: true });
      expect(make("cancelled")).toMatchObject({ travelled: false, planned: false });
    }
  );

  it("rental: pick-up is the departure, the operator is who ran it, rental days are counted", () => {
    const r = journeyFromRental({
      id: "car",
      status: "completed",
      provider: "Sunny Cars",
      operatedBy: "Sixt",
      pickupStationName: "Faro Airport",
      returnStationName: "Lisbon Airport",
      pickupLat: 37.017,
      pickupLon: -7.968,
      returnLat: 38.774,
      returnLon: -9.134,
      pickupTimezone: "Europe/Lisbon",
      returnTimezone: "Europe/Lisbon",
      distanceKm: null,
      vehicleClass: "Compact",
      times: {
        pickup: { utc: "2024-05-01T09:00:00Z" },
        return: { utc: "2024-05-04T09:00:00Z" },
      },
    } as unknown as Parameters<typeof journeyFromRental>[0]);
    expect(r).toMatchObject({
      domain: "rental",
      travelled: true,
      operator: "Sixt",
      distanceKm: null,
      departureTime: "2024-05-01T09:00:00Z",
      facts: { vehicleClass: "Compact", rentalDays: 3 },
    });
  });

  it("trip flight: flown counts, scheduled is planned, distance is the great circle", () => {
    const f = journeyFromTripFlight({
      id: "f",
      status: "flown",
      depIata: "FRA",
      arrIata: "LIS",
      depLat: 50.033,
      depLon: 8.57,
      arrLat: 38.774,
      arrLon: -9.134,
    });
    expect(f?.travelled).toBe(true);
    expect(f?.distanceKm).toBeGreaterThan(1800);
    expect(f?.distanceKm).toBeLessThan(1950);
    expect(journeyFromTripFlight({ id: "x", status: "scheduled", depLat: null })).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { adaptFlight } from "../flightStatsAdapter";
import { adaptCruise } from "../cruiseStatsAdapter";
import { adaptHotel } from "../hotelStatsAdapter";
import { adaptPoi } from "../poiStatsAdapter";
import type { Flight } from "../../../../types";
import type { CruiseStatsResponse } from "../../../api/stats";
import type { Cruise } from "../../../../types/cruise";

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
    ...overrides,
  };
}

const baseStats: CruiseStatsResponse = {
  cruisesCount: 0,
  cruisePortsUnique: 0,
  cruisePortsSingleMax: 0,
  cruiseShipsUnique: 0,
  cruiseLinesUnique: 0,
  cruiseLineLoyaltyMax: 0,
  cruiseLines: [],
  seaDays: 0,
  seaDaysStreak: 0,
  regions: [],
  regionVisitCounts: {},
  countries: [],
  totalDistanceKm: 0,
  longestLegKm: 0,
  totalPortCalls: 0,
  totalCruiseDays: 0,
  hasBalconyCabin: false,
  hasSuiteCabin: false,
  maxDeck: 0,
  hasCanalTransit: false,
  hasPolar: false,
  hasColdWater: false,
  hasDatelineCrossing: false,
  hasBirthdayAtSea: false,
  hasNewYearsAtSea: false,
};

function makeCruise(overrides: Partial<Cruise>): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2024-06-01",
    endDate: "2024-06-08",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    createdAt: "2024-06-01T00:00:00Z",
    stops: [],
    ...overrides,
  } as Cruise;
}

describe("adaptFlight", () => {
  it("returns hasData=false on empty input", () => {
    const stats = adaptFlight({ flights: [], countries: [] });
    expect(stats).toEqual({ domain: "flight", hasData: false });
  });

  it("collapses multiple flights on the same day to 1 active day", () => {
    const stats = adaptFlight({
      flights: [
        makeFlight({ id: "1", departureTime: "2024-03-15T08:00:00Z" }),
        makeFlight({ id: "2", departureTime: "2024-03-15T18:00:00Z" }),
      ],
      countries: ["DE", "US"],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(2);
    expect(stats.yearlyEvents[2024]).toBe(2);
    expect(stats.yearlyActiveDays[2024]).toBe(1);
    expect(stats.monthlyActiveDays["2024-03"]).toBe(1);
    expect(stats.dailyActiveDays["2024-03-15"]).toBe(1);
  });

  it("aggregates haversine distance and duration", () => {
    const stats = adaptFlight({
      flights: [makeFlight({})],
      countries: ["DE", "US"],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalDistanceKm).toBeGreaterThan(6000);
    expect(stats.totalDurationHours).toBeCloseTo(8, 1);
    expect(stats.summary.headlineKpis[0].label).toBe("Distanz");
    expect(stats.summary.topItems?.items[0].label).toBe("Lufthansa");
  });
});

describe("adaptCruise", () => {
  it("returns hasData=false when stats reports no cruises", () => {
    const stats = adaptCruise({ stats: { ...baseStats, cruisesCount: 0 }, cruises: [] });
    expect(stats).toEqual({ domain: "cruise", hasData: false });
  });

  it("expands a cruise into per-day buckets across its full span", () => {
    const stats = adaptCruise({
      stats: {
        ...baseStats,
        cruisesCount: 1,
        totalDistanceKm: 1000,
        seaDays: 3,
        cruisePortsUnique: 5,
        countries: ["IT"],
        cruiseLines: ["AIDA"],
        hasPolar: true,
      },
      cruises: [makeCruise({ startDate: "2024-06-01", endDate: "2024-06-03" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents[2024]).toBe(1);
    expect(stats.yearlyActiveDays[2024]).toBe(3);
    expect(stats.monthlyActiveDays["2024-06"]).toBe(3);
    expect(stats.dailyActiveDays["2024-06-01"]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-02"]).toBe(1);
    expect(stats.dailyActiveDays["2024-06-03"]).toBe(1);
    expect(stats.summary.badges?.find((b) => b.label === "Polar-Region")).toBeDefined();
  });

  it("splits day-buckets correctly across year boundary", () => {
    const stats = adaptCruise({
      stats: { ...baseStats, cruisesCount: 1, cruiseLines: ["MSC"] },
      cruises: [makeCruise({ startDate: "2023-12-30", endDate: "2024-01-02" })],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyActiveDays[2023]).toBe(2);
    expect(stats.yearlyActiveDays[2024]).toBe(2);
    expect(stats.monthlyActiveDays["2023-12"]).toBe(2);
    expect(stats.monthlyActiveDays["2024-01"]).toBe(2);
  });

  it("filters out scheduled and cancelled cruises", () => {
    const stats = adaptCruise({
      stats: { ...baseStats, cruisesCount: 1, cruiseLines: ["AIDA"] },
      cruises: [makeCruise({ status: "scheduled" })],
    });
    expect(stats).toEqual({ domain: "cruise", hasData: false });
  });
});

describe("stub adapters", () => {
  it("lodging returns hasData=false", () => {
    expect(adaptHotel()).toEqual({ domain: "lodging", hasData: false });
  });
  it("poi returns hasData=false", () => {
    expect(adaptPoi()).toEqual({ domain: "poi", hasData: false });
  });
});

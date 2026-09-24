import { describe, it, expect } from "vitest";

import { adaptRoadtrip } from "../roadtripStatsAdapter";
import type { RoadtripSummary } from "../../../../types/roadtrip";

function roadtrip(overrides: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r1",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "Norwegen",
    mode: "road",
    color: null,
    vehicle: "motorhome",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2024-07-12T00:00:00.000Z",
    endDate: "2024-07-14T00:00:00.000Z",
    distanceKm: 1200,
    drivenKm: 1060,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["DE", "NO"],
    ...overrides,
  };
}

const NOW = new Date("2026-09-24T12:00:00Z");

describe("adaptRoadtrip", () => {
  it("files a roadtrip under the year it started, and marks every day it covered", () => {
    const stats = adaptRoadtrip({ roadtrips: [roadtrip({})], now: NOW });
    expect(stats.hasData).toBe(true);
    if (!stats.hasData) return;
    expect(stats.totalEvents).toBe(1);
    expect(stats.yearlyEvents).toEqual({ 2024: 1 });
    expect(stats.yearlyActiveDays).toEqual({ 2024: 3 });
    expect(Object.keys(stats.dailyActiveDays)).toHaveLength(3);
    expect(stats.countries.sort()).toEqual(["DE", "NO"]);
    expect(stats.countriesByYear).toEqual({ 2024: ["DE", "NO"] });
  });

  it("counts a planned roadtrip nowhere", () => {
    const stats = adaptRoadtrip({
      roadtrips: [roadtrip({ id: "future", startDate: "2027-06-01T00:00:00.000Z", endDate: null })],
      now: NOW,
    });
    expect(stats.hasData).toBe(false);
  });

  it("counts an undated roadtrip in the lifetime figures and in no year", () => {
    const stats = adaptRoadtrip({
      roadtrips: [roadtrip({ startDate: null, endDate: null, distanceKm: 300 })],
      now: NOW,
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(1);
    expect(stats.totalDistanceKm).toBe(300);
    expect(stats.yearlyEvents).toEqual({});
  });

  it("does not count a day twice when two roadtrips overlap", () => {
    const stats = adaptRoadtrip({
      roadtrips: [roadtrip({ id: "a" }), roadtrip({ id: "b" })],
      now: NOW,
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(2);
    expect(stats.yearlyActiveDays).toEqual({ 2024: 3 });
  });
});

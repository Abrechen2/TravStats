import { describe, it, expect } from "vitest";

import { adaptRail } from "../railStatsAdapter";
import type { RailJourney } from "../../../../types/rail";

const ride = (over: Partial<RailJourney> = {}): RailJourney =>
  ({
    id: "r1",
    status: "completed",
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    depStationName: "Frankfurt (Main) Hbf",
    arrStationName: "Berlin Hbf",
    depCountry: "DE",
    arrCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Berlin",
    departureTime: "2025-06-12T06:00:00.000Z",
    arrivalTime: "2025-06-12T10:00:00.000Z",
    distanceKm: 423,
    distanceSource: "great_circle",
    ...over,
  }) as RailJourney;

const kpi = (stats: ReturnType<typeof adaptRail>, key: string): unknown =>
  stats.hasData ? stats.summary.headlineKpis.find((k) => k.labelKey === key)?.value : undefined;

describe("adaptRail", () => {
  it("has no data without a completed ride", () => {
    expect(
      adaptRail({ journeys: [ride({ status: "scheduled" }), ride({ status: "cancelled" })] })
    ).toEqual({ domain: "rail", hasData: false });
  });

  it("counts completed rides only", () => {
    const stats = adaptRail({
      journeys: [
        ride(),
        ride({ id: "r2", status: "scheduled" }),
        ride({ id: "r3", status: "in_progress" }),
      ],
    });
    expect(stats.hasData && stats.totalEvents).toBe(1);
    expect(kpi(stats, "overviewCard.kpi.railJourneys")).toBe(1);
  });

  it("keeps straight-line kilometres apart from the traced and ticket ones", () => {
    const stats = adaptRail({
      journeys: [
        ride({ distanceKm: 400, distanceSource: "great_circle" }),
        ride({ id: "r2", distanceKm: 550, distanceSource: "route" }),
        ride({ id: "r3", distanceKm: 50, distanceSource: "user" }),
        ride({ id: "r4", distanceKm: null, distanceSource: null }),
      ],
    });
    expect(kpi(stats, "overviewCard.kpi.railKmStraight")).toBe(400);
    expect(kpi(stats, "overviewCard.kpi.railKmMeasured")).toBe(600);
    expect(stats.hasData && stats.totalDistanceKm).toBe(1000);
  });

  it("shows no measured-km figure when every ride is straight-line", () => {
    const stats = adaptRail({ journeys: [ride()] });
    expect(kpi(stats, "overviewCard.kpi.railKmMeasured")).toBeUndefined();
    expect(kpi(stats, "overviewCard.kpi.railKmStraight")).toBe(423);
  });

  it("files a night train under the year it left, active on both station days", () => {
    // 22:58 in Vienna on 31 Dec is 21:58 UTC; it arrives in Zurich on 1 Jan.
    const stats = adaptRail({
      journeys: [
        ride({
          depCountry: "AT",
          arrCountry: "CH",
          depTimezone: "Europe/Vienna",
          arrTimezone: "Europe/Zurich",
          departureTime: "2025-12-31T21:58:00.000Z",
          arrivalTime: "2026-01-01T07:20:00.000Z",
        }),
      ],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents).toEqual({ 2025: 1 });
    expect(stats.dailyEvents).toEqual({ "2025-12-31": 1 });
    expect(Object.keys(stats.dailyActiveDays).sort()).toEqual(["2025-12-31", "2026-01-01"]);
    expect(stats.yearlyActiveDays).toEqual({ 2025: 1, 2026: 1 });
    expect(stats.countries.sort()).toEqual(["AT", "CH"]);
    expect(stats.countriesByYear?.[2025]?.sort()).toEqual(["AT", "CH"]);
  });

  it("measures hours only over rides with an arrival", () => {
    const stats = adaptRail({ journeys: [ride(), ride({ id: "r2", arrivalTime: null })] });
    expect(stats.hasData && stats.totalDurationHours).toBe(4);
  });

  it("links the card to the rail statistics tab", () => {
    const stats = adaptRail({ journeys: [ride()] });
    expect(stats.hasData && stats.summary.detailRoute).toBe("/stats?tab=rail");
  });
});

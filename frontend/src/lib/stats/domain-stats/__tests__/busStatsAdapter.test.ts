import { describe, it, expect } from "vitest";

import { adaptBus } from "../busStatsAdapter";
import { adaptRail } from "../railStatsAdapter";
import { aggregate } from "../../../../components/Stats/Overview/aggregate";
import type { BusJourney } from "../../../../types/bus";
import type { RailJourney } from "../../../../types/rail";

/**
 * forgejo#265 — bus joins the overview's cross-domain figures as one domain
 * beside the others: a completed ride is one experience, its terminals'
 * countries and its days are unioned with every other domain's, so a coach
 * ride on the day of a train ride in the same country adds an experience but
 * no second day and no second country.
 */
const ride = (over: Partial<BusJourney> = {}): BusJourney =>
  ({
    id: "b1",
    status: "completed",
    operator: "FlixBus",
    depStationName: "Berlin ZOB",
    arrStationName: "Praha Florenc",
    depCountry: "DE",
    arrCountry: "CZ",
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Prague",
    departureTime: "2025-06-12T06:00:00.000Z",
    arrivalTime: "2025-06-12T10:30:00.000Z",
    distanceKm: 280,
    distanceSource: "great_circle",
    ...over,
  }) as BusJourney;

describe("adaptBus", () => {
  it("counts completed rides only, with both terminals' countries", () => {
    expect(adaptBus({ journeys: [ride({ status: "cancelled" })] })).toEqual({
      domain: "bus",
      hasData: false,
    });
    const stats = adaptBus({ journeys: [ride(), ride({ id: "b2", status: "scheduled" })] });
    expect(stats.hasData && stats.totalEvents).toBe(1);
    expect(stats.hasData && [...stats.countries].sort()).toEqual(["CZ", "DE"]);
    expect(stats.hasData && stats.summary.detailRoute).toBe("/stats?tab=bus");
  });

  it("is counted once beside a train ride the same day: one more experience, no extra day", () => {
    const bus = adaptBus({ journeys: [ride()] });
    const rail = adaptRail({
      journeys: [
        {
          id: "r1",
          status: "completed",
          depStationName: "Hamburg Hbf",
          arrStationName: "Berlin Hbf",
          depCountry: "DE",
          arrCountry: "DE",
          depTimezone: "Europe/Berlin",
          arrTimezone: "Europe/Berlin",
          departureTime: "2025-06-12T03:00:00.000Z",
          arrivalTime: "2025-06-12T05:00:00.000Z",
          distanceKm: 255,
          distanceSource: "route",
          operator: "DB",
        } as RailJourney,
      ],
    });
    const agg = aggregate({ bus, rail }, { bus: true, rail: true }, 2025);
    expect(agg.totalEvents).toBe(2);
    expect(agg.perDomainEvents).toMatchObject({ bus: 1, rail: 1 });
    expect(agg.activeDays).toBe(1);
    expect(agg.countriesCount).toBe(2);
    // The chip off takes the bus out of every figure.
    const off = aggregate({ bus, rail }, { bus: false, rail: true }, 2025);
    expect(off).toMatchObject({ totalEvents: 1, countriesCount: 1, activeDays: 1 });
  });
});

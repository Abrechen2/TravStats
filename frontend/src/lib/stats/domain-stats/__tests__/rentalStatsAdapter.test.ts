import { describe, it, expect } from "vitest";

import { adaptRental } from "../rentalStatsAdapter";
import { adaptBus } from "../busStatsAdapter";
import { aggregate } from "../../../../components/Stats/Overview/aggregate";
import type { RentalBooking } from "../../../../types/rental";
import type { BusJourney } from "../../../../types/bus";

/**
 * Board item rental-missing-from-stats-overview: the overview knew no rental
 * at all. A returned rental is one experience there now — and, by rental spec
 * §11 D3 a, still adds no active travel day and no country.
 */
const at = (utc: string, local: string) => ({
  utc,
  zone: "Europe/Lisbon",
  offset: "+00:00",
  local,
  precision: "minute" as const,
  zoneSource: "stored" as const,
});

const rental = (over: Partial<RentalBooking> = {}): RentalBooking =>
  ({
    id: "r1",
    provider: "Sixt",
    status: "completed",
    pickupTimezone: "Europe/Lisbon",
    returnTimezone: "Europe/Lisbon",
    pickupCountry: "PT",
    returnCountry: "PT",
    distanceKm: 412,
    distanceSource: "invoice",
    odometerOutKm: null,
    odometerInKm: null,
    // Picked up late on New Year's Eve in Lisbon and returned on 2 January:
    // filed under 2025, two rental days.
    times: {
      pickup: at("2025-12-31T23:30:00.000Z", "2025-12-31T23:30:00"),
      return: at("2026-01-02T10:00:00.000Z", "2026-01-02T10:00:00"),
      actualPickup: null,
      actualReturn: null,
    },
    ...over,
  }) as RentalBooking;

describe("adaptRental", () => {
  it("counts returned rentals only", () => {
    expect(adaptRental({ rentals: [rental({ status: "scheduled" })] })).toEqual({
      domain: "rental",
      hasData: false,
    });
    const stats = adaptRental({
      rentals: [rental(), rental({ id: "r2", status: "cancelled" })],
    });
    expect(stats.hasData && stats.totalEvents).toBe(1);
  });

  it("files a rental under its pickup station's year, with days and km on the card", () => {
    const stats = adaptRental({ rentals: [rental()] });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.yearlyEvents).toEqual({ 2025: 1 });
    expect(stats.dailyEvents).toEqual({ "2025-12-31": 1 });
    expect(stats.summary.headlineKpis).toEqual([
      { labelKey: "overviewCard.kpi.rentals", value: 1 },
      { labelKey: "overviewCard.kpi.rentalDays", value: 2 },
      { labelKey: "overviewCard.kpi.rentalKm", value: 412, unit: "km" },
    ]);
    expect(stats.summary.detailRoute).toBe("/stats?tab=rental");
  });

  it("leaves km out rather than saying 0 when no rental knows them", () => {
    const stats = adaptRental({ rentals: [rental({ distanceKm: null, distanceSource: null })] });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.summary.headlineKpis.map((k) => k.labelKey)).not.toContain(
      "overviewCard.kpi.rentalKm"
    );
  });

  it("adds an experience to the overview, but no travel day and no country", () => {
    const ride = {
      id: "b1",
      status: "completed",
      operator: "FlixBus",
      depStationName: "Lisboa",
      arrStationName: "Porto",
      depCountry: "PT",
      arrCountry: "PT",
      depTimezone: "Europe/Lisbon",
      arrTimezone: "Europe/Lisbon",
      departureTime: "2025-06-12T06:00:00.000Z",
      arrivalTime: "2025-06-12T10:30:00.000Z",
      distanceKm: 300,
      distanceSource: "great_circle",
    } as BusJourney;
    const busOnly = aggregate({ bus: adaptBus({ journeys: [ride] }) }, {}, 2025);
    const withRental = aggregate(
      { bus: adaptBus({ journeys: [ride] }), rental: adaptRental({ rentals: [rental()] }) },
      {},
      2025
    );
    expect(withRental.totalEvents).toBe(busOnly.totalEvents + 1);
    expect(withRental.perDomainEvents.rental).toBe(1);
    expect(withRental.activeDays).toBe(busOnly.activeDays);
  });
});

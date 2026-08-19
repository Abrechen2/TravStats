import { describe, it, expect } from "vitest";
import { computeTripInsights, tripDistanceKm, tripDominantCost } from "../tripInsights";
import type { Trip } from "../../../types";

const trip = (over: Partial<Trip>): Trip =>
  ({
    id: "t",
    name: "Trip",
    countries: [],
    flights: [],
    cruises: [],
    bookings: [],
    lodgingStays: [],
    ...over,
  }) as Trip;

// MUC -> JFK is ~6,200 km great-circle.
const muc = { depLat: 48.35, depLon: 11.78, arrLat: 40.64, arrLon: -73.78 };
const flight = (over: Record<string, unknown> = {}) =>
  ({ id: "f", depIata: "MUC", arrIata: "JFK", ...muc, ...over }) as never;

describe("tripInsights", () => {
  it("sums flight great-circle plus cruise legs for distance", () => {
    const km = tripDistanceKm(
      trip({ flights: [flight()], cruises: [{ id: "c", distanceKm: 1000 } as never] })
    );
    expect(km).toBeGreaterThan(7000);
    expect(km).toBeLessThan(7500);
  });

  it("takes the biggest per-currency bucket, never summing across currencies", () => {
    const c = tripDominantCost(
      trip({
        bookings: [
          { price: 300, currency: "EUR" },
          { price: 480, currency: "USD" },
        ] as never,
      })
    );
    expect(c).toEqual({ currency: "USD", amount: 480 });
  });

  it("picks the winning trip per metric", () => {
    const trips = [
      trip({ id: "short", name: "Short", flights: [flight()], countries: ["DE", "US"] }),
      trip({
        id: "long",
        name: "Long",
        flights: [flight(), flight({ id: "f2" })],
        bookings: [{ price: 5000, currency: "EUR" }] as never,
        countries: ["DE"],
      }),
      trip({ id: "wide", name: "Wide", countries: ["DE", "US", "JP", "FR", "IT"] }),
    ];
    const r = computeTripInsights(trips, "en");
    expect(r.longest?.tripId).toBe("long");
    expect(r.mostExpensive?.tripId).toBe("long");
    expect(r.mostExpensive?.value).toBe("EUR 5,000");
    expect(r.mostCountries?.tripId).toBe("wide");
    expect(r.mostCountries?.value).toBe("5");
  });

  it("returns null winners when nothing qualifies", () => {
    const r = computeTripInsights([trip({})], "en");
    expect(r.longest).toBeNull();
    expect(r.mostExpensive).toBeNull();
    expect(r.mostCountries).toBeNull();
  });

  it("ignores planned trips for all superlatives", () => {
    const trips = [
      trip({
        id: "planned",
        name: "Planned",
        status: "planned",
        // MUC -> SYD is ~16,000 km great-circle — far longer than the
        // completed trip below, so the old (unfiltered) behaviour would
        // wrongly crown this one.
        flights: [flight({ id: "pf", arrLat: -33.87, arrLon: 151.21 })],
        countries: ["DE", "AU"],
        bookings: [{ price: 9000, currency: "EUR" }] as never,
      }),
      trip({
        id: "done",
        name: "Done",
        status: "completed",
        flights: [flight()],
        countries: ["DE"],
        bookings: [{ price: 300, currency: "EUR" }] as never,
      }),
    ];
    const r = computeTripInsights(trips, "en");
    expect(r.longest?.tripId).toBe("done");
    expect(r.mostExpensive?.tripId).toBe("done");
    expect(r.mostCountries?.tripId).toBe("done");
  });
});

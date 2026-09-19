import { describe, it, expect } from "vitest";
import { computeTripInsights, tripDistanceKm, tripDominantCost } from "../tripInsights";
import type { Trip } from "../../../types";
import type { TripCostSuperlative } from "../../api/trips";

const noExclusions = { count: 0, reason: "unconvertible" } as const;

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
    const mostExpensiveTrip: TripCostSuperlative = {
      tripId: "long",
      name: "Long",
      amount: 5000,
      currency: "EUR",
      excluded: noExclusions,
    };
    const r = computeTripInsights(trips, "en", mostExpensiveTrip);
    expect(r.longest?.tripId).toBe("long");
    expect(r.mostExpensive?.tripId).toBe("long");
    // Through `formatCurrency` like every other money figure (forgejo#86):
    // this used to be a hand-glued "EUR 5,000" while the trip card wrote "€5,000".
    expect(r.mostExpensive?.value).toBe("€5,000");
    expect(r.mostCountries?.tripId).toBe("wide");
    expect(r.mostCountries?.value).toBe("5");
    expect(r.mostExpensiveExcludedCount).toBe(0);
  });

  it("returns null winners when nothing qualifies", () => {
    const r = computeTripInsights([trip({})], "en", null);
    expect(r.longest).toBeNull();
    expect(r.mostExpensive).toBeNull();
    expect(r.mostCountries).toBeNull();
    expect(r.mostExpensiveExcludedCount).toBe(0);
  });

  it("carries the exclusion count through from the backend (fix round 1, finding 2)", () => {
    // Backend `TripCostSuperlative.excluded.count` used to be computed and
    // then dropped on the floor here — the panel had no way to say "some
    // trips could not be compared".
    const trips = [trip({ id: "winner", name: "Winner" })];
    const mostExpensiveTrip: TripCostSuperlative = {
      tripId: "winner",
      name: "Winner",
      amount: 1000,
      currency: "EUR",
      excluded: { count: 3, reason: "unconvertible" },
    };
    const r = computeTripInsights(trips, "en", mostExpensiveTrip);
    expect(r.mostExpensiveExcludedCount).toBe(3);
  });

  it("ignores planned trips for the frontend-computed superlatives", () => {
    // `mostExpensive` is no longer computed here — planned-trip exclusion for
    // it is the backend's job (`mostExpensiveTrip`'s own `status: { not:
    // "planned" }` filter, tested in `tripCostSuperlative.test.ts`). This
    // covers `longest`/`mostCountries`, which `computeTripInsights` still
    // derives from the trips it is handed.
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
      }),
      trip({
        id: "done",
        name: "Done",
        status: "completed",
        flights: [flight()],
        countries: ["DE"],
      }),
    ];
    const r = computeTripInsights(trips, "en", null);
    expect(r.longest?.tripId).toBe("done");
    expect(r.mostCountries?.tripId).toBe("done");
  });

  it("passes the backend winner through untouched, including a currency the raw-number bug would have lost", () => {
    // The defect this whole change fixes: comparing face values across
    // currencies let 334.000 ¥ beat 1.650 €. That comparison now happens
    // backend-side; here we only check the frontend renders whatever the
    // backend decided, unconditionally on the amount's SIZE.
    const trips = [trip({ id: "small-eur", name: "Weekend" })];
    const mostExpensiveTrip: TripCostSuperlative = {
      tripId: "small-eur",
      name: "Weekend",
      amount: 1650,
      currency: "EUR",
      excluded: { count: 1, reason: "unconvertible" },
    };
    const r = computeTripInsights(trips, "de", mostExpensiveTrip);
    expect(r.mostExpensive).toEqual({
      tripId: "small-eur",
      name: "Weekend",
      amount: 1650,
      // NBSP before the symbol, exactly like `Intl.NumberFormat("de-DE", …)`
      // — a plain space here would silently fail on the invisible character.
      value: "1.650 €",
    });
  });
});

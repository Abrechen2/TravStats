import { describe, it, expect } from "vitest";

import { deriveCruiseStats, nightsBetween } from "../cruiseStatsDetail";
import type { Cruise } from "../../../types/cruise";

const cruise = (over: Partial<Cruise> & { id: string }): Cruise =>
  ({
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2023-04-01",
    endDate: "2023-04-08",
    status: "flown",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: "2023-01-01",
    updatedAt: "2023-01-01",
    ...over,
  }) as unknown as Cruise;

const stop = (isAtSea: boolean) => ({ portId: null, dayNumber: 1, isAtSea });

describe("deriveCruiseStats", () => {
  it("never adds two currencies together", () => {
    // The whole reason this module reports per currency: a cruise carries a
    // price and a currency and no FX snapshot, so 300 EUR + 400 USD has no
    // honest sum. Printing 700 is the defect #267 described for flights.
    const d = deriveCruiseStats([
      cruise({ id: "c1", price: 300, currency: "EUR" }),
      cruise({ id: "c2", price: 400, currency: "USD" }),
    ]);

    expect(d.spendByCurrency).toHaveLength(2);
    expect(d.spendByCurrency.map((s) => s.currency).sort()).toEqual(["EUR", "USD"]);
    expect(d.spendByCurrency.find((s) => s.currency === "USD")?.total).toBe(400);
    expect(d.spendByCurrency.some((s) => s.total === 700)).toBe(false);
  });

  it("says how many cruises the money figures actually describe", () => {
    const d = deriveCruiseStats([
      cruise({ id: "c1", price: 300, currency: "EUR" }),
      cruise({ id: "c2" }),
      cruise({ id: "c3", price: 0, currency: "EUR" }),
    ]);

    // A price of zero is not a price — it is the field left alone.
    expect(d.pricedCruises).toBe(1);
    expect(d.unpricedCruises).toBe(2);
  });

  it("counts port calls and not sea days", () => {
    // Otherwise a transatlantic crossing is the most-visited itinerary in the
    // logbook, which is the opposite of true.
    const d = deriveCruiseStats([
      cruise({ id: "c1", stops: [stop(false), stop(false), stop(true)] as never }),
      cruise({ id: "c2", stops: [stop(true), stop(true), stop(true), stop(true)] as never }),
    ]);

    expect(d.mostPorts?.cruise.id).toBe("c1");
    expect(d.mostPorts?.ports).toBe(2);
  });

  it("keeps a cruise with no dates in the counts and out of the calendar", () => {
    const d = deriveCruiseStats([
      cruise({ id: "c1", startDate: "2023-04-01", endDate: "2023-04-08" }),
      cruise({ id: "c2", startDate: null, endDate: null }),
    ]);

    expect(d.undatedCount).toBe(1);
    expect(d.dated.map((c) => c.id)).toEqual(["c1"]);
    expect(d.byYear).toEqual([{ year: 2023, cruises: 1 }]);
    expect(d.byMonth.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("names the first, the longest and the shortest", () => {
    const d = deriveCruiseStats([
      cruise({ id: "later", startDate: "2024-01-01", endDate: "2024-01-04" }),
      cruise({ id: "first", startDate: "2019-06-01", endDate: "2019-06-15" }),
    ]);

    expect(d.first?.id).toBe("first");
    expect(d.longest).toMatchObject({ nights: 14 });
    expect(d.shortest).toMatchObject({ nights: 3 });
    expect(d.averageNights).toBe(8.5);
  });

  it("takes the highest deck actually slept on", () => {
    const d = deriveCruiseStats([
      cruise({ id: "c1", deck: 6 }),
      cruise({ id: "c2", deck: 12 }),
      cruise({ id: "c3" }),
    ]);

    expect(d.highestDeck).toMatchObject({ deck: 12 });
    expect(d.highestDeck?.cruise.id).toBe("c2");
  });

  it("survives an empty logbook", () => {
    const d = deriveCruiseStats([]);

    expect(d.first).toBeNull();
    expect(d.longest).toBeNull();
    expect(d.averageNights).toBeNull();
    expect(d.spendByCurrency).toEqual([]);
    expect(d.byMonth).toHaveLength(12);
  });
});

describe("nightsBetween", () => {
  it("counts nights, not days", () => {
    expect(nightsBetween("2023-04-01", "2023-04-08")).toBe(7);
  });

  it("refuses a missing or backwards pair rather than returning a negative", () => {
    expect(nightsBetween(null, "2023-04-08")).toBeNull();
    expect(nightsBetween("2023-04-08", "2023-04-01")).toBeNull();
    expect(nightsBetween("nicht ein datum", "2023-04-08")).toBeNull();
  });

  it("counts a same-day cruise as no nights rather than as nothing", () => {
    expect(nightsBetween("2023-04-01", "2023-04-01")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { journeyFromFerry, journeyFromRail, journeyFromRental } from "../journeyNormalize";
import { getJourneyRouteFigures } from "../journeyRouteFigures";
import type { MapJourney } from "../journeyTypes";
import type { TimeValue } from "../../../../../shared/time";

/**
 * The route card's own statistics (owner, 2026-10-21): how often, first and
 * last, average/fastest/slowest duration, average delay, and for a rental
 * km/day, cost/day, cost/km and rental length. Every figure abstains — is
 * null, and the card omits its row — when it cannot be derived; money is
 * never added across currencies.
 */

function tv(utc: string, precision: TimeValue["precision"] = "minute", zone = "Europe/Berlin") {
  const d = new Date(utc);
  const local = new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(0, 19);
  return { utc, zone, offset: "+02:00", local, precision } satisfies TimeValue;
}

const ENDS = {
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.14,
  arrStationName: "Oslo",
  arrLat: 59.9,
  arrLon: 10.75,
};

function ferry(
  id: string,
  dep: string,
  arr: string | null,
  over: Record<string, unknown> = {}
): MapJourney {
  const precision = (over.precision as TimeValue["precision"]) ?? "minute";
  return journeyFromFerry({
    id,
    status: "completed",
    ...ENDS,
    departureTime: dep,
    arrivalTime: arr,
    distanceKm: 684,
    distanceSource: "sea_route",
    delayMinutes: null,
    times: {
      departure: tv(dep, precision),
      arrival: arr ? tv(arr, precision) : null,
      actualDeparture: null,
      actualArrival: null,
    },
    ...over,
  } as Parameters<typeof journeyFromFerry>[0]);
}

describe("route first and last", () => {
  it("names the first and the last travelled journey, by when they happened", () => {
    const f = getJourneyRouteFigures([
      ferry("b", "2023-07-01T10:00:00Z", "2023-07-02T06:00:00Z"),
      ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z"),
      ferry("c", "2025-07-01T10:00:00Z", "2025-07-02T06:00:00Z", { status: "scheduled" }),
    ]);
    expect(f.first?.id).toBe("a");
    expect(f.last?.id).toBe("b");
  });

  it("has no first when only one journey happened — it would repeat the last", () => {
    const f = getJourneyRouteFigures([ferry("a", "2021-07-01T10:00:00Z", null)]);
    expect(f.first).toBeNull();
    expect(f.last?.id).toBe("a");
  });
});

describe("route durations", () => {
  it("averages the clocked journeys and names the fastest and the slowest", () => {
    const f = getJourneyRouteFigures([
      ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z"), // 20 h
      ferry("b", "2022-07-01T10:00:00Z", "2022-07-02T08:00:00Z"), // 22 h
      ferry("c", "2023-07-01T10:00:00Z", "2023-07-02T04:00:00Z"), // 18 h
    ]);
    expect(f.duration).toEqual({
      averageMin: 20 * 60,
      measured: 3,
      fastest: { journeyId: "c", minutes: 18 * 60 },
      slowest: { journeyId: "b", minutes: 22 * 60 },
    });
  });

  it("leaves date-only journeys out of the average instead of counting them as 0 or a day", () => {
    const f = getJourneyRouteFigures([
      ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z"),
      ferry("b", "2022-06-30T22:00:00Z", "2022-07-01T22:00:00Z", { precision: "day" }),
    ]);
    expect(f.duration?.averageMin).toBe(20 * 60);
    expect(f.duration?.measured).toBe(1);
    // One measured journey is no ranking.
    expect(f.duration?.fastest).toBeNull();
    expect(f.duration?.slowest).toBeNull();
  });

  it("abstains when no journey was timed", () => {
    expect(getJourneyRouteFigures([ferry("a", "2021-07-01T10:00:00Z", null)]).duration).toBeNull();
  });

  it("does not let a planned journey into the average", () => {
    const f = getJourneyRouteFigures([
      ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z"),
      ferry("b", "2030-07-01T10:00:00Z", "2030-07-01T12:00:00Z", { status: "scheduled" }),
    ]);
    expect(f.duration?.averageMin).toBe(20 * 60);
  });
});

describe("route delay", () => {
  it("averages the recorded delays and says over how many journeys", () => {
    const f = getJourneyRouteFigures([
      ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z", { delayMinutes: 30 }),
      ferry("b", "2022-07-01T10:00:00Z", "2022-07-02T06:00:00Z", { delayMinutes: 0 }),
      ferry("c", "2023-07-01T10:00:00Z", "2023-07-02T06:00:00Z", { delayMinutes: null }),
    ]);
    expect(f.delay).toEqual({ averageMin: 15, measured: 2 });
  });

  it("abstains when no delay is recorded — never 'on time' for unknown", () => {
    const f = getJourneyRouteFigures([ferry("a", "2021-07-01T10:00:00Z", "2021-07-02T06:00:00Z")]);
    expect(f.delay).toBeNull();
  });

  it("ignores a delay on a ride without clocks, as the rail statistics do", () => {
    const f = getJourneyRouteFigures([
      ferry("a", "2021-06-30T22:00:00Z", "2021-07-01T22:00:00Z", {
        precision: "day",
        delayMinutes: 40,
      }),
    ]);
    expect(f.delay).toBeNull();
  });
});

function rental(id: string, over: Record<string, unknown> = {}): MapJourney {
  return journeyFromRental({
    id,
    status: "completed",
    provider: "Sixt",
    pickupStationName: "Faro Airport",
    returnStationName: "Faro Airport",
    pickupLat: 37.02,
    pickupLon: -7.97,
    returnLat: 37.02,
    returnLon: -7.97,
    pickupTimezone: "Europe/Lisbon",
    returnTimezone: "Europe/Lisbon",
    distanceKm: null,
    distanceSource: null,
    odometerOutKm: null,
    odometerInKm: null,
    price: null,
    currency: null,
    finalAmount: null,
    finalCurrency: null,
    times: {
      pickup: tv("2024-05-01T09:00:00Z", "minute", "Europe/Lisbon"),
      return: tv("2024-05-05T09:00:00Z", "minute", "Europe/Lisbon"),
      actualPickup: null,
      actualReturn: null,
    },
    ...over,
  } as Parameters<typeof journeyFromRental>[0]);
}

describe("rental figures", () => {
  it("derives length, km/day, cost/day and cost/km from the rentals that carry them", () => {
    const f = getJourneyRouteFigures([
      rental("a", { distanceKm: 400, distanceSource: "invoice", price: 200, currency: "EUR" }),
      rental("b", {
        distanceKm: 200,
        distanceSource: "invoice",
        finalAmount: 120,
        finalCurrency: "EUR",
      }),
    ]);
    expect(f.rental?.averageDays).toBe(4);
    expect(f.rental?.kmPerDay).toBe(75);
    expect(f.rental?.costPerDay).toEqual([{ currency: "EUR", amount: 40, rentals: 2 }]);
    expect(f.rental?.costPerKm).toEqual([{ currency: "EUR", amount: 0.53, rentals: 2 }]);
  });

  it("never adds two currencies — each gets its own figure", () => {
    const f = getJourneyRouteFigures([
      rental("a", { price: 200, currency: "EUR" }),
      rental("b", { price: 300, currency: "USD" }),
    ]);
    expect(f.rental?.costPerDay).toEqual([
      { currency: "EUR", amount: 50, rentals: 1 },
      { currency: "USD", amount: 75, rentals: 1 },
    ]);
  });

  it("abstains from km/day and cost/km without driven km, and from cost without a price", () => {
    const f = getJourneyRouteFigures([rental("a")]);
    expect(f.rental?.averageDays).toBe(4);
    expect(f.rental?.kmPerDay).toBeNull();
    expect(f.rental?.costPerDay).toEqual([]);
    expect(f.rental?.costPerKm).toEqual([]);
  });

  it("leaves a cancelled rental's fee out of every cost figure", () => {
    const f = getJourneyRouteFigures([
      rental("a", { price: 200, currency: "EUR" }),
      rental("b", { status: "cancelled", finalAmount: 50, finalCurrency: "EUR" }),
    ]);
    expect(f.rental?.costPerDay).toEqual([{ currency: "EUR", amount: 50, rentals: 1 }]);
  });

  it("is null for a rail route", () => {
    const r = journeyFromRail({
      id: "r",
      status: "completed",
      ...ENDS,
    } as Parameters<typeof journeyFromRail>[0]);
    expect(getJourneyRouteFigures([r]).rental).toBeNull();
  });
});

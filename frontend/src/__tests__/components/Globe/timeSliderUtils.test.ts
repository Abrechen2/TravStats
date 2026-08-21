import { describe, it, expect } from "vitest";
import type { Cruise, CruiseStop, Port } from "../../../types/cruise";
import type { GeoJSONFeature } from "../../../types";
import {
  computeCruiseLegDates,
  computeTimeRange,
  computeMonthlyBuckets,
  flightVisibleFilter,
  flightVisibleLive,
  legProgress,
  legVisibleFilter,
  truncatePolyline,
} from "../../../components/Globe/timeSliderUtils";

const port = (id: number, name = `P${id}`): Port => ({
  id,
  name,
  city: null,
  country: null,
  unlocode: null,
  lat: 0,
  lon: 0,
  timezone: null,
  region: null,
  isUserAdded: false,
});

const stop = (overrides: Partial<CruiseStop>): CruiseStop => ({
  id: "stop-x",
  cruiseId: "cruise-x",
  portId: 1,
  port: port(1),
  dayNumber: 1,
  date: null,
  isAtSea: false,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
  ...overrides,
});

const baseCruise = (overrides: Partial<Cruise>): Cruise => ({
  id: "cruise-x",
  userId: "u",
  shipId: null,
  ship: null,
  shipNameOverride: null,
  cruiseLine: null,
  routeName: null,
  departurePortId: null,
  departurePort: null,
  arrivalPortId: null,
  arrivalPort: null,
  startDate: null,
  endDate: null,
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
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const flightFeat = (departureTime: string | null): GeoJSONFeature => ({
  type: "Feature",
  properties: {
    id: "f1",
    airline: "LH",
    flightNumber: "100",
    departureAirport: { iata: "FRA" },
    arrivalAirport: { iata: "JFK" },
    departureTime,
    arrivalTime: null,
    status: "flown",
    distance: 6200,
  },
  geometry: { type: "LineString", coordinates: [] },
});

describe("computeCruiseLegDates", () => {
  it("derives leg dates from per-stop departure/arrival times when available", () => {
    const cruise = baseCruise({
      stops: [
        stop({
          id: "s1",
          dayNumber: 1,
          port: port(10),
          departureTime: "2024-08-01T18:00:00Z",
        }),
        stop({
          id: "s2",
          dayNumber: 3,
          port: port(20),
          arrivalTime: "2024-08-03T08:00:00Z",
        }),
      ],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs).toHaveLength(1);
    expect(legs[0].fromPortId).toBe(10);
    expect(legs[0].toPortId).toBe(20);
    expect(legs[0].startDate.toISOString()).toBe("2024-08-01T18:00:00.000Z");
    expect(legs[0].endDate.toISOString()).toBe("2024-08-03T08:00:00.000Z");
  });

  it("falls back to startDate + dayNumber offset when per-stop times are null", () => {
    const cruise = baseCruise({
      startDate: "2024-08-01T00:00:00Z",
      stops: [
        stop({ id: "s1", dayNumber: 1, port: port(10) }),
        stop({ id: "s2", dayNumber: 4, port: port(20) }),
      ],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs[0].startDate.toISOString()).toBe("2024-08-01T00:00:00.000Z");
    // Day 4 = startDate + 3 days
    expect(legs[0].endDate.toISOString()).toBe("2024-08-04T00:00:00.000Z");
  });

  it("skips sea-day stops when building leg pairs", () => {
    const cruise = baseCruise({
      startDate: "2024-08-01T00:00:00Z",
      stops: [
        stop({ id: "s1", dayNumber: 1, port: port(10) }),
        stop({ id: "s2", dayNumber: 2, port: null, portId: null, isAtSea: true }),
        stop({ id: "s3", dayNumber: 3, port: port(20) }),
      ],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs).toHaveLength(1);
    expect(legs[0].fromPortId).toBe(10);
    expect(legs[0].toPortId).toBe(20);
  });

  it("returns empty when only one port stop is present", () => {
    const cruise = baseCruise({
      startDate: "2024-08-01T00:00:00Z",
      stops: [stop({ id: "s1", dayNumber: 1, port: port(10) })],
    });
    expect(computeCruiseLegDates(cruise)).toEqual([]);
  });

  it("clamps a corrupt end<start pair to a zero-length window at start", () => {
    const cruise = baseCruise({
      stops: [
        stop({
          id: "s1",
          dayNumber: 1,
          port: port(10),
          departureTime: "2024-08-05T12:00:00Z",
        }),
        stop({
          id: "s2",
          dayNumber: 2,
          port: port(20),
          arrivalTime: "2024-08-02T12:00:00Z", // earlier than s1 dep!
        }),
      ],
    });
    const [leg] = computeCruiseLegDates(cruise);
    expect(leg.startDate.getTime()).toBe(leg.endDate.getTime());
  });
});

describe("computeCruiseLegDates includes departure and arrival ports", () => {
  const HAMBURG = port(10, "Hamburg");
  const SOUTHAMPTON = port(11, "Southampton");
  const LISBON = port(12, "Lisbon");

  it("produces two legs for departure → one stop → arrival", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [stop({ id: "s1", portId: SOUTHAMPTON.id, port: SOUTHAMPTON, dayNumber: 2 })],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([
      [HAMBURG.id, SOUTHAMPTON.id],
      [SOUTHAMPTON.id, LISBON.id],
    ]);
  });

  it("produces one leg for a cruise with no stops at all", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs).toHaveLength(1);
    expect(legs[0].fromPortId).toBe(HAMBURG.id);
    expect(legs[0].toPortId).toBe(LISBON.id);
    expect(legs[0].startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(legs[0].endDate.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("does not duplicate a departure port that is also the first port call", () => {
    const cruise = baseCruise({
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-04T00:00:00.000Z",
      departurePort: HAMBURG,
      arrivalPort: LISBON,
      stops: [
        stop({ id: "s1", portId: HAMBURG.id, port: HAMBURG, dayNumber: 1 }),
        stop({ id: "s2", portId: SOUTHAMPTON.id, port: SOUTHAMPTON, dayNumber: 2 }),
      ],
    });
    const legs = computeCruiseLegDates(cruise);
    expect(legs.map((l) => [l.fromPortId, l.toPortId])).toEqual([
      [HAMBURG.id, SOUTHAMPTON.id],
      [SOUTHAMPTON.id, LISBON.id],
    ]);
  });
});

describe("computeTimeRange", () => {
  it("returns null when there are no dated items", () => {
    expect(computeTimeRange([], [])).toBeNull();
  });

  it("spans across flights and cruises", () => {
    const flight = flightFeat("2018-03-15T10:00:00Z");
    const cruise = baseCruise({
      startDate: "2015-06-01T00:00:00Z",
      endDate: "2015-06-08T00:00:00Z",
    });
    const range = computeTimeRange([flight], [cruise])!;
    expect(range.min.toISOString()).toBe("2015-06-01T00:00:00.000Z");
    expect(range.max.toISOString()).toBe("2018-03-15T10:00:00.000Z");
  });
});

describe("legProgress", () => {
  const leg = {
    cruiseId: "c",
    fromPortId: 1,
    toPortId: 2,
    startDate: new Date("2024-08-01T00:00:00Z"),
    endDate: new Date("2024-08-03T00:00:00Z"),
  };

  it("returns 0 before start", () => {
    expect(legProgress(leg, new Date("2024-07-31T00:00:00Z"))).toBe(0);
  });

  it("returns 1 after end", () => {
    expect(legProgress(leg, new Date("2024-08-04T00:00:00Z"))).toBe(1);
  });

  it("returns the correct fraction mid-leg", () => {
    expect(legProgress(leg, new Date("2024-08-02T00:00:00Z"))).toBeCloseTo(0.5);
  });
});

describe("flightVisibleLive / flightVisibleFilter", () => {
  it("flightVisibleLive returns false when departureTime is null", () => {
    expect(flightVisibleLive(flightFeat(null), new Date())).toBe(false);
  });

  it("flightVisibleLive becomes true at the departure instant", () => {
    const f = flightFeat("2020-05-01T00:00:00Z");
    expect(flightVisibleLive(f, new Date("2020-04-30T23:59:59Z"))).toBe(false);
    expect(flightVisibleLive(f, new Date("2020-05-01T00:00:00Z"))).toBe(true);
  });

  it("flightVisibleFilter is inclusive on both ends", () => {
    const f = flightFeat("2020-05-01T00:00:00Z");
    const start = new Date("2020-05-01T00:00:00Z");
    const end = new Date("2020-12-31T23:59:59Z");
    expect(flightVisibleFilter(f, start, end)).toBe(true);
  });
});

describe("legVisibleFilter", () => {
  const leg = {
    cruiseId: "c",
    fromPortId: 1,
    toPortId: 2,
    startDate: new Date("2024-06-01T00:00:00Z"),
    endDate: new Date("2024-06-08T00:00:00Z"),
  };

  it("hides legs entirely before the window", () => {
    expect(
      legVisibleFilter(leg, new Date("2024-07-01T00:00:00Z"), new Date("2024-07-30T00:00:00Z"))
    ).toBe(false);
  });

  it("shows legs that touch the window's edge", () => {
    expect(
      legVisibleFilter(leg, new Date("2024-06-08T00:00:00Z"), new Date("2024-12-31T00:00:00Z"))
    ).toBe(true);
  });
});

describe("truncatePolyline", () => {
  // 4 vertices, 3 equal-length segments (~111 km each at the equator)
  const eq: Array<[number, number]> = [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ];

  it("returns empty at progress 0", () => {
    expect(truncatePolyline(eq, 0)).toEqual([]);
  });

  it("returns the full input at progress >= 1", () => {
    expect(truncatePolyline(eq, 1)).toEqual(eq);
    expect(truncatePolyline(eq, 1.5)).toEqual(eq);
  });

  it("returns a partial prefix that ends at the interpolated point", () => {
    const p = truncatePolyline(eq, 0.5);
    expect(p[0]).toEqual([0, 0]);
    // Last point is interpolated halfway through the polyline (lng ≈ 1.5)
    const last = p[p.length - 1];
    expect(last[0]).toBe(0);
    expect(last[1]).toBeCloseTo(1.5, 5);
  });

  it("preserves the last vertex when progress lands exactly on a node", () => {
    const p = truncatePolyline(eq, 1 / 3);
    const last = p[p.length - 1];
    expect(last[1]).toBeCloseTo(1, 5);
  });
});

describe("computeMonthlyBuckets", () => {
  it("counts flights + cruises per month across the range", () => {
    const flights = [
      flightFeat("2022-07-05T10:00:00Z"),
      flightFeat("2022-07-20T10:00:00Z"),
      flightFeat("2022-09-01T10:00:00Z"),
      flightFeat(null), // no date → ignored
    ];
    const cruises = [baseCruise({ startDate: "2022-08-10T00:00:00Z" })];
    const min = new Date("2022-07-01T00:00:00Z");
    const max = new Date("2022-09-30T00:00:00Z");

    const buckets = computeMonthlyBuckets(flights, cruises, min, max);

    expect(buckets).toHaveLength(3); // Jul, Aug, Sep
    expect(buckets[0].flights).toBe(2);
    expect(buckets[0].start.getUTCMonth()).toBe(6); // July
    expect(buckets[1].cruises).toBe(1); // Aug
    expect(buckets[2].flights).toBe(1); // Sep
  });

  it("returns contiguous months even when empty", () => {
    const buckets = computeMonthlyBuckets(
      [],
      [],
      new Date("2023-01-15T00:00:00Z"),
      new Date("2023-04-15T00:00:00Z")
    );
    expect(buckets).toHaveLength(4);
    expect(buckets.every((b) => b.flights === 0 && b.cruises === 0)).toBe(true);
  });
});

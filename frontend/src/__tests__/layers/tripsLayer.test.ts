import { describe, it, expect } from "vitest";
import { buildTripsData, getTimeRange } from "../../components/layers/tripsLayer";
import type { GeoJSONFeature } from "../../types";

const mockFlight: GeoJSONFeature = {
  type: "Feature",
  properties: {
    id: "f1",
    airline: "LH",
    flightNumber: "LH1",
    departureAirport: { iata: "FRA", lat: 50.03, lon: 8.57 },
    arrivalAirport: { iata: "JFK", lat: 40.64, lon: -73.78 },
    departureTime: "2024-06-01T10:00:00Z",
    arrivalTime: "2024-06-01T18:00:00Z",
    status: "flown",
    distance: 6200,
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [8.57, 50.03],
      [-73.78, 40.64],
    ],
  },
};

describe("buildTripsData", () => {
  it("converts flights to trip paths with timestamps", () => {
    const trips = buildTripsData([mockFlight]);
    expect(trips).toHaveLength(1);
    // The path is the densified great circle since 2026-09-20 — it used to be
    // the two endpoints, which is why the animation did not follow the route.
    // One timestamp per vertex, because TripsLayer pairs them by index.
    expect(trips[0].path.length).toBeGreaterThan(2);
    expect(trips[0].timestamps).toHaveLength(trips[0].path.length);
  });

  it("timestamps are Unix seconds (not milliseconds)", () => {
    const trips = buildTripsData([mockFlight]);
    // 2024 dates are > 1.7 billion Unix seconds
    expect(trips[0].timestamps[0]).toBeGreaterThan(1700000000);
    // But < 2 trillion (would indicate milliseconds)
    expect(trips[0].timestamps[0]).toBeLessThan(2000000000000);
  });

  it("departure timestamp < arrival timestamp", () => {
    const trips = buildTripsData([mockFlight]);
    expect(trips[0].timestamps[0]).toBeLessThan(
      trips[0].timestamps[trips[0].timestamps.length - 1]
    );
  });

  it("skips flights with missing geometry coordinates", () => {
    const incomplete: GeoJSONFeature = {
      ...mockFlight,
      geometry: { type: "LineString", coordinates: [] },
    };
    const trips = buildTripsData([incomplete]);
    expect(trips).toHaveLength(0);
  });
});

describe("getTimeRange", () => {
  it("returns min and max timestamps from trips", () => {
    const trips = buildTripsData([mockFlight]);
    const range = getTimeRange(trips);
    expect(range.min).toBeLessThan(range.max);
    expect(range.min).toBe(trips[0].timestamps[0]);
    expect(range.max).toBe(trips[0].timestamps[trips[0].timestamps.length - 1]);
  });
});

/**
 * The scrubber ran from 01.01.1970 to late 2027 while the earliest flight in
 * the account was 2012, so most of the track showed a blank map — and at
 * exactly t=0 every trail rendered at once as a ghost (browser verification,
 * beta.12).
 *
 * The cause is upstream of the range: `buildTripsData` mapped a flight with
 * no departure or arrival time to `t0 = t1 = 0`, the epoch. The NaN filter
 * below it let that through, because 0 is a perfectly good number. One
 * undated flight was enough to pull the minimum back fifty-four years.
 *
 * A flight with no times has no place on a timeline. Abstain — leave it out —
 * rather than pin it to 1970: "a value that cannot be derived is null or
 * absent, never zero" (CLAUDE.md).
 */
describe("an undated flight stays off the timeline", () => {
  const undated: GeoJSONFeature = {
    ...mockFlight,
    properties: { ...mockFlight.properties, id: "f2", departureTime: null, arrivalTime: null },
  } as GeoJSONFeature;

  const halfDated: GeoJSONFeature = {
    ...mockFlight,
    properties: { ...mockFlight.properties, id: "f3", arrivalTime: null },
  } as GeoJSONFeature;

  it("is left out of the trips data entirely", () => {
    expect(buildTripsData([undated])).toHaveLength(0);
  });

  it("does not drag the slider's minimum back to the epoch", () => {
    const range = getTimeRange(buildTripsData([mockFlight, undated]));
    expect(range.min).toBeGreaterThan(0);
    // 2024-06-01T10:00:00Z in Unix seconds.
    expect(range.min).toBe(Date.parse("2024-06-01T10:00:00Z") / 1000);
  });

  it("leaves out a flight that has only one of the two times", () => {
    // Animating from a real departure to 1970 is not half an answer.
    expect(buildTripsData([halfDated])).toHaveLength(0);
  });

  it("still reports no range at all for an empty set", () => {
    expect(getTimeRange(buildTripsData([undated]))).toEqual({ min: 0, max: 0 });
  });
});

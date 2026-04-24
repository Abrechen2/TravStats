import { describe, it, expect } from "vitest";
import { createCruiseArcsLayer } from "./cruiseArcsLayer";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";

function makeStop(
  dayNumber: number,
  portId: number | null,
  port: { id: number; lat: number; lon: number } | null,
  isAtSea = false
): Cruise["stops"][number] {
  const base = {
    id: `s${dayNumber}`,
    cruiseId: "c1",
    portId,
    port: port
      ? {
          id: port.id,
          name: `Port ${port.id}`,
          city: null,
          country: null,
          unlocode: null,
          lat: port.lat,
          lon: port.lon,
          timezone: null,
          region: null,
          isUserAdded: false,
        }
      : null,
    dayNumber,
    isAtSea,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
  };
  return base as Cruise["stops"][number];
}

function makeCruise(stops: Cruise["stops"]): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA Cruises",
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status: "scheduled",
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
    stops,
    createdAt: "",
    updatedAt: "",
  };
}

describe("createCruiseArcsLayer", () => {
  it("returns null when no cruises have ≥ 2 qualifying stops", () => {
    const cruise = makeCruise([makeStop(1, 1, { id: 1, lat: 0, lon: 0 })]);
    expect(createCruiseArcsLayer([cruise])).toBeNull();
  });

  it("falls back to a 2-point chord when no geometry is provided", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArcsLayer([cruise]);
    expect(layer).not.toBeNull();
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    // 2 waypoints → spline returns them unchanged (direct chord).
    expect(data[0].path).toEqual([
      [2.17, 41.38],
      [11.8, 42.1],
    ]);
  });

  it("splines the backend waypoints into a smooth curve", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 44.42, lon: 12.2 }),
      makeStop(2, 2, { id: 2, lat: 36.39, lon: 25.46 }),
    ]);
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [12.2, 44.42],
              [18, 40],
              [22.5, 37.5],
              [25.46, 36.39],
            ],
          },
          properties: { fromPortId: 1, toPortId: 2, routed: true },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map);
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    // Spline first + last match waypoints exactly.
    expect(data[0].path[0]).toEqual([12.2, 44.42]);
    expect(data[0].path[data[0].path.length - 1]).toEqual([25.46, 36.39]);
    // Far more vertices than the 4 waypoints — curve densified.
    expect(data[0].path.length).toBeGreaterThan(20);
  });

  it("skips at-sea stops + stops without a resolved port when pairing", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, null, null, true),
      makeStop(3, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArcsLayer([cruise]);
    const data = (layer as { props: { data: unknown } }).props.data as unknown[];
    expect(data).toHaveLength(1);
  });
});

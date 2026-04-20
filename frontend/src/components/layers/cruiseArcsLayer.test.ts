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

  it("falls back to Bezier when no geometry is provided", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArcsLayer([cruise]);
    expect(layer).not.toBeNull();
    // PathLayer internally stores data via props.data — read it back.
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      computed: boolean;
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].computed).toBe(false);
    // Bezier arc has at least 2 points; default resolution is 64 → 65 pts.
    expect(data[0].path.length).toBeGreaterThan(2);
  });

  it("uses computed A* geometry when the geometry map has a matching leg", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [2.17, 41.38],
              [6, 41],
              [11.8, 42.1],
            ],
          },
          properties: { fromPortId: 1, toPortId: 2, computed: true },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map);
    expect(layer).not.toBeNull();
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      computed: boolean;
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].computed).toBe(true);
    expect(data[0].path).toEqual([
      [2.17, 41.38],
      [6, 41],
      [11.8, 42.1],
    ]);
  });

  it("skips at-sea stops + stops without a resolved port when pairing", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, null, null, true), // sea day
      makeStop(3, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArcsLayer([cruise]);
    expect(layer).not.toBeNull();
    const data = (layer as { props: { data: unknown } }).props.data as unknown[];
    // 1→2 (day 1 → day 3) — sea-day was filtered out.
    expect(data).toHaveLength(1);
  });
});

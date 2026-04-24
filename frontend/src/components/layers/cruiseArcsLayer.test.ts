import { describe, it, expect } from "vitest";
import { countSchematicLegs, createCruiseArcsLayer } from "./cruiseArcsLayer";
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

  it("falls back to a dashed chord when no geometry is provided", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArcsLayer([cruise]);
    expect(layer).not.toBeNull();
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      quality: "good" | "schematic";
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].quality).toBe("schematic");
    // Chord = exactly the two endpoints, no curvature.
    expect(data[0].path).toEqual([
      [2.17, 41.38],
      [11.8, 42.1],
    ]);
  });

  it("uses computed A* geometry when the geometry map flags the leg good", () => {
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
          properties: { fromPortId: 1, toPortId: 2, quality: "good", landRatio: 0 },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map);
    expect(layer).not.toBeNull();
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      quality: "good" | "schematic";
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].quality).toBe("good");
    expect(data[0].path).toEqual([
      [2.17, 41.38],
      [6, 41],
      [11.8, 42.1],
    ]);
  });

  it("falls back to a chord when the backend flagged the leg schematic", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 53.54, lon: 9.97 }), // Hamburg
      makeStop(2, 2, { id: 2, lat: 60.39, lon: 5.32 }), // Bergen
    ]);
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [9.97, 53.54],
              [10, 55],
              [7, 57],
              [5.32, 60.39],
            ],
          },
          // Backend decided this polyline crosses too much land.
          properties: { fromPortId: 1, toPortId: 2, quality: "schematic", landRatio: 0.53 },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map);
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      quality: "good" | "schematic";
      path: [number, number][];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].quality).toBe("schematic");
    // Chord replaces the backend polyline — zero intermediate vertices.
    expect(data[0].path).toEqual([
      [9.97, 53.54],
      [5.32, 60.39],
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

describe("countSchematicLegs", () => {
  const cruise = makeCruise([
    makeStop(1, 1, { id: 1, lat: 53.54, lon: 9.97 }),
    makeStop(2, 2, { id: 2, lat: 60.39, lon: 5.32 }),
    makeStop(3, 3, { id: 3, lat: 59.91, lon: 10.75 }),
  ]);

  it("returns 0 when all legs have good geometry", () => {
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { fromPortId: 1, toPortId: 2, quality: "good", landRatio: 0 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { fromPortId: 2, toPortId: 3, quality: "good", landRatio: 0 },
        },
      ],
    };
    expect(countSchematicLegs(cruise, geometry)).toBe(0);
  });

  it("counts legs with schematic geometry", () => {
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { fromPortId: 1, toPortId: 2, quality: "schematic", landRatio: 0.5 },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { fromPortId: 2, toPortId: 3, quality: "good", landRatio: 0 },
        },
      ],
    };
    expect(countSchematicLegs(cruise, geometry)).toBe(1);
  });

  it("counts missing legs (backend skipped them) as schematic", () => {
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { fromPortId: 2, toPortId: 3, quality: "good", landRatio: 0 },
        },
      ],
    };
    expect(countSchematicLegs(cruise, geometry)).toBe(1);
  });

  it("returns 0 when the cruise has fewer than 2 qualifying stops", () => {
    const empty = makeCruise([makeStop(1, 1, { id: 1, lat: 0, lon: 0 })]);
    expect(countSchematicLegs(empty, undefined)).toBe(0);
  });

  it("counts every leg as schematic when no geometry has been fetched yet", () => {
    expect(countSchematicLegs(cruise, undefined)).toBe(2);
  });
});

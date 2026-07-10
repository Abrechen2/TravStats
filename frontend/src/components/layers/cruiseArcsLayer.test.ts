import { describe, it, expect } from "vitest";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "./cruiseArcsLayer";
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
    routeName: null,
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

  it("keeps protected harbor approaches exact before smoothing the open-sea section", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 53.55, lon: 9.97 }),
      makeStop(2, 2, { id: 2, lat: 60.39, lon: 5.32 }),
    ]);
    const coordinates: [number, number][] = [
      [9.97, 53.55],
      [9.7, 53.56],
      [9.12, 53.88],
      [8.18, 54.05],
      [5.32, 60.39],
    ];
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            fromPortId: 1,
            toPortId: 2,
            routed: true,
            protectedPrefixCount: 3,
            protectedSuffixCount: 0,
            method: "maritime_graph",
          },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map);
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      path: [number, number][];
    }>;

    expect(data[0].path.slice(0, 3)).toEqual(coordinates.slice(0, 3));
    expect(data[0].path.length).toBeGreaterThan(coordinates.length);
  });

  it("renders backend geometry directly at close zoom levels", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 53.55, lon: 9.97 }),
      makeStop(2, 2, { id: 2, lat: 60.39, lon: 5.32 }),
    ]);
    const coordinates: [number, number][] = [
      [9.97, 53.55],
      [9.7, 53.56],
      [9.12, 53.88],
      [8.18, 54.05],
      [5.32, 60.39],
    ];
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            fromPortId: 1,
            toPortId: 2,
            routed: true,
            protectedPrefixCount: 3,
            protectedSuffixCount: 0,
            method: "maritime_graph",
          },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const layer = createCruiseArcsLayer([cruise], map, null, undefined, { zoom: 8 });
    const data = (layer as { props: { data: unknown } }).props.data as Array<{
      path: [number, number][];
    }>;

    expect(data[0].path).toEqual(coordinates);
  });

  it("renders no arrow layer when there are no qualifying legs", () => {
    const cruise = makeCruise([makeStop(1, 1, { id: 1, lat: 0, lon: 0 })]);
    expect(createCruiseArrowsLayer([cruise])).toBeNull();
  });

  it("emits one arrow per cruise leg, oriented along the leg", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    expect(arrows).not.toBeNull();
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
      angleDeg: number;
      cruiseId: string;
    }>;
    expect(data).toHaveLength(1);
    // Anchor sits past the source longitude on the destination side.
    expect(data[0].position[0]).toBeGreaterThan(2.17);
    expect(data[0].cruiseId).toBe(cruise.id);
    // East-and-slightly-north heading (dx>0, dy>0 in raw lon/lat deltas) →
    // a first-quadrant angle under deck.gl's icon/text rotation convention
    // (angle 0 = east, positive = counterclockwise, verified against
    // icon-layer-vertex.glsl.js — see pickArrowAnchor's comment). A prior
    // version of this code negated dy, which mirrored every arrow
    // vertically (fourth-quadrant angle here instead) — #160.
    expect(data[0].angleDeg).toBeGreaterThan(0);
    expect(data[0].angleDeg).toBeLessThan(90);
  });

  it("renders the arrow as a white-bordered icon, not a bare glyph (#160)", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise]) as unknown as {
      props: {
        data: unknown[];
        getIcon: (d: unknown) => { url: string; width: number; height: number };
      };
    };
    const icon = layer.props.getIcon(layer.props.data[0]);
    expect(icon.url).toContain("data:image/svg+xml");
    const svg = decodeURIComponent(icon.url.split(",")[1]);
    expect(svg).toContain('stroke="white"');
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

  it("scales the arrow size by arrowSizeScale", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise], new Map(), null, { arrowSizeScale: 2 });
    expect((layer as unknown as { props: { getSize: number } }).props.getSize).toBe(20);
  });

  it("defaults arrow size to the base height when no scale is given", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise]);
    expect((layer as unknown as { props: { getSize: number } }).props.getSize).toBe(10);
  });

  it("returns null when arrowSizeScale is 0 (arrows off)", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    expect(createCruiseArrowsLayer([cruise], new Map(), null, { arrowSizeScale: 0 })).toBeNull();
  });
});

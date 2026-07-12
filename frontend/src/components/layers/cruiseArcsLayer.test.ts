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

// Reported 2.3.1 bug: "cruise arrows all seem to sit IN the port." Root
// cause was two-fold: (1) the anchor was deliberately placed at ~88% of
// the leg — right before the destination port, and (2) the code indexed
// into the vertex array (`path[floor(path.length * 0.88)]`) instead of
// interpolating by real-world arc length, which lands even closer to the
// port on a densified spline (more vertices cluster near harbour
// approaches). These tests drive the arc-length-based replacement.
describe("cruise arrow placement — arc length, not vertex index (2.3.1 fix)", () => {
  it("places the arrow near the geometric middle of a non-uniformly spaced leg, not the vertex-dense end (regression)", () => {
    // Straight leg along the equator from lon 0 to lon 10 (~1113 km — well
    // above the minimum and well below the 2-arrow threshold, so exactly
    // one arrow is expected at the midpoint, lon ≈ 5). Vertices are
    // deliberately sparse for the first 80% and dense for the last ~13%,
    // exactly mimicking a Catmull-Rom spline's harbour-approach density.
    // zoom >= EXACT_ROUTE_ZOOM (8) makes the layer render these raw
    // coordinates verbatim (no further spline pass), so the anchor logic
    // is exercised directly against this exact vertex distribution.
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 10 }),
    ]);
    const coordinates: [number, number][] = [
      [0, 0],
      [4, 0],
      [8, 0],
      [9, 0],
      [9.3, 0],
      [9.5, 0],
      [9.65, 0],
      [9.75, 0],
      [9.83, 0],
      [9.89, 0],
      [9.93, 0],
      [9.96, 0],
      [9.98, 0],
      [9.99, 0],
      [10, 0],
    ];
    const geometry: CruiseRouteFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: { fromPortId: 1, toPortId: 2, routed: true },
        },
      ],
    };
    const map = new Map([[cruise.id, geometry]]);
    const arrows = createCruiseArrowsLayer([cruise], map, null, { zoom: 8 });
    expect(arrows).not.toBeNull();
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(1);
    // The geometric middle of a straight 0→10 leg is lon 5. The old
    // index-based code (`floor(path.length * 0.88)` = index 13 of 15)
    // lands at lon 9.99 — inside the vertex-dense cluster next to the
    // destination port — which falls well outside this range.
    expect(data[0].position[0]).toBeGreaterThan(3);
    expect(data[0].position[0]).toBeLessThan(7);
  });

  it("gives a short leg exactly one arrow, placed away from both endpoints", () => {
    // ~111 km leg (1 degree of longitude at the equator) — above the
    // minimum-length floor but far below the 2-arrow interval.
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 1 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    expect(arrows).not.toBeNull();
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(1);
    // Midpoint (lon 0.5), clearly off both port markers at lon 0 and lon 1.
    expect(data[0].position[0]).toBeCloseTo(0.5, 1);
  });

  it("gives a long leg several arrows, evenly spaced, none near the endpoints", () => {
    // ~4449 km leg (40 degrees of longitude at the equator) — long enough
    // to round up to 3 arrows at the chosen 1500 km spacing interval.
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 40 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    expect(arrows).not.toBeNull();
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(3);
    const lons = data.map((d) => d.position[0]).sort((a, b) => a - b);
    // Evenly spaced at fractions 1/4, 2/4, 3/4 of the leg → lon 10, 20, 30.
    expect(lons[0]).toBeCloseTo(10, 0);
    expect(lons[1]).toBeCloseTo(20, 0);
    expect(lons[2]).toBeCloseTo(30, 0);
    // None within 5 degrees (~550 km) of either port at lon 0 / lon 40.
    for (const lon of lons) {
      expect(lon).toBeGreaterThan(5);
      expect(lon).toBeLessThan(35);
    }
  });

  it("draws no arrow at all when the leg is below the minimum length", () => {
    // ~5.6 km leg (0.05 degrees of longitude at the equator) — an arrow
    // here would overlap the port markers no matter where it's placed.
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 0.05 }),
    ]);
    expect(createCruiseArrowsLayer([cruise])).toBeNull();
  });

  it("still points a west→east leg east under the existing rotation convention", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 10 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      angleDeg: number;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].angleDeg).toBeCloseTo(0, 5);
  });

  it("still points a north→south leg south under the existing rotation convention", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 10, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 0 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      angleDeg: number;
    }>;
    expect(data).toHaveLength(1);
    // No sign flip on dy (#160): decreasing latitude → negative dy →
    // angleDeg = atan2(negative, 0) = -90 (south), never +90 (north).
    expect(data[0].angleDeg).toBeCloseTo(-90, 5);
  });
});

// Reported on 2.4.0-rc.1: an out-and-back cruise (A→B→A that is not a
// circular route) draws both legs on the same path, so the two midpoint
// arrows land on exactly the same spot and render as an unreadable "X".
// When a leg's opposite direction is also on the map, each arrow shifts
// toward its own journey's first half so the pair flanks the midpoint.
describe("cruise arrow placement — opposing legs don't overlap (out-and-back)", () => {
  const outAndBack = () =>
    makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 10 }),
      makeStop(3, 1, { id: 1, lat: 0, lon: 0 }),
    ]);

  it("separates the two arrows of an out-and-back cruise along the shared path", () => {
    const arrows = createCruiseArrowsLayer([outAndBack()]);
    expect(arrows).not.toBeNull();
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(2);
    const lons = data.map((d) => d.position[0]).sort((a, b) => a - b);
    // Both used to sit at the shared midpoint (lon 5). Now they flank it
    // with a clear gap (≥ 10% of the leg) and stay away from both ports.
    expect(lons[1] - lons[0]).toBeGreaterThan(1);
    expect(lons[0]).toBeGreaterThan(2);
    expect(lons[1]).toBeLessThan(8);
  });

  it("keeps each arrow pointing in its own travel direction", () => {
    const arrows = createCruiseArrowsLayer([outAndBack()]);
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
      angleDeg: number;
    }>;
    const eastbound = data.find((d) => Math.abs(d.angleDeg) < 1);
    const westbound = data.find((d) => Math.abs(Math.abs(d.angleDeg) - 180) < 1);
    expect(eastbound).toBeDefined();
    expect(westbound).toBeDefined();
    // Each arrow sits in the first half of its own journey: the eastbound
    // (0→10) arrow west of the midpoint, the westbound (10→0) arrow east of it.
    expect(eastbound!.position[0]).toBeLessThan(5);
    expect(westbound!.position[0]).toBeGreaterThan(5);
  });

  it("also separates opposing legs when they belong to two different cruises", () => {
    const forward = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 10 }),
    ]);
    const backward = {
      ...makeCruise([
        makeStop(1, 2, { id: 2, lat: 0, lon: 10 }),
        makeStop(2, 1, { id: 1, lat: 0, lon: 0 }),
      ]),
      id: "c2",
    };
    const arrows = createCruiseArrowsLayer([forward, backward]);
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(2);
    const lons = data.map((d) => d.position[0]).sort((a, b) => a - b);
    expect(lons[1] - lons[0]).toBeGreaterThan(1);
  });

  it("leaves a plain one-way leg at the exact midpoint (no shift without an opposing twin)", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 0, lon: 0 }),
      makeStop(2, 2, { id: 2, lat: 0, lon: 10 }),
    ]);
    const arrows = createCruiseArrowsLayer([cruise]);
    const data = (arrows as { props: { data: unknown } }).props.data as Array<{
      position: [number, number];
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].position[0]).toBeCloseTo(5, 1);
  });
});

// Reported on 2.4.0-rc.1: arrows go blurry when scaled up. The SVG data-URL
// is rasterised by the browser at the SVG's declared width/height, so a
// 22×16 icon stretched to 2.5× on a HiDPI display samples a 16-px bitmap
// at ~75 device pixels. The icon must be rasterised at a multiple of its
// display size so every slider setting stays crisp.
describe("cruise arrow icon — rasterised above display resolution (sharp when scaled)", () => {
  it("declares an icon raster several times larger than the on-screen size", () => {
    const cruise = makeCruise([
      makeStop(1, 1, { id: 1, lat: 41.38, lon: 2.17 }),
      makeStop(2, 2, { id: 2, lat: 42.1, lon: 11.8 }),
    ]);
    const layer = createCruiseArrowsLayer([cruise]) as unknown as {
      props: {
        data: unknown[];
        getSize: number;
        getIcon: (d: unknown) => { url: string; width: number; height: number };
      };
    };
    const icon = layer.props.getIcon(layer.props.data[0]);
    // Max slider setting is 2.5× on up to ~3× devicePixelRatio ⇒ the raster
    // must be at least ~75 device px tall to never upsample.
    expect(icon.height).toBeGreaterThanOrEqual(75);
    // The SVG itself must be declared at the raster size — deck.gl draws the
    // decoded image at its natural size, so a small SVG with big icon dims
    // would still rasterise small (and blurry).
    const svg = decodeURIComponent(icon.url.split(",")[1]);
    expect(svg).toContain(`width="${icon.width}"`);
    expect(svg).toContain(`height="${icon.height}"`);
  });
});

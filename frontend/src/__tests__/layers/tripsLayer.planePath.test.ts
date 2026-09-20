// "Die Flieger-Animation folgt nicht der Route" (owner, 2026-09-20).
//
// She was right, and the cause was one line: `buildTripsData` handed the
// TripsLayer `path: [coords[0], coords[last]]` — two points. The animated
// trail therefore travelled the straight lon/lat chord between the airports
// while the map drew the route as an arc, so on a long westbound leg the
// moving head and its own route were visibly different lines.
//
// It also means there was never a plane to follow: trips mode draws ONLY the
// TripsLayer (DeckGLMap.tsx, `case "trips"`), so what the owner was watching
// was the fading head of a trail. There is one now, and it points where it is
// going.
//
// The independent check below does not reuse the layer's own path: it derives
// the expected midpoint and tangent from `interpolateGreatCircle` directly, so
// a wrong path cannot agree with itself.

import { describe, it, expect } from "vitest";
import {
  buildPlaneData,
  buildTripsData,
  createPlaneLayer,
  getTimeRange,
  planeAt,
} from "../../components/layers/tripsLayer";
import { interpolateGreatCircle } from "../../components/layers/greatCircle";
import { MercatorCoordinate } from "maplibre-gl";
import type { GeoJSONFeature } from "../../types";

const LPA: [number, number] = [-15.3866, 27.9319];
const YVR: [number, number] = [-123.184, 49.1947];
// A second, northerly pair — its great circle crests at 77°N, where Mercator's
// latitude stretch is large enough that a lon/lat heading is 26° wrong.
const KEF: [number, number] = [-22.6056, 63.985];
const ANC: [number, number] = [-149.996, 61.1744];

const DEP = "2024-05-01T08:00:00Z";
const ARR = "2024-05-01T19:00:00Z";
const T0 = new Date(DEP).getTime() / 1000;
const T1 = new Date(ARR).getTime() / 1000;

const lpaYvr: GeoJSONFeature = {
  type: "Feature",
  properties: {
    id: "f1",
    airline: "AC",
    flightNumber: "AC1",
    departureAirport: { iata: "LPA", lat: LPA[1], lon: LPA[0] },
    arrivalAirport: { iata: "YVR", lat: YVR[1], lon: YVR[0] },
    departureTime: DEP,
    arrivalTime: ARR,
    status: "flown",
    distance: 7800,
  },
  geometry: { type: "LineString", coordinates: [LPA, YVR] },
} as unknown as GeoJSONFeature;

/**
 * The course as MAPLIBRE would draw it at fraction `t`.
 *
 * Two things are deliberately independent of the implementation. The tangent
 * is a centred finite difference on the slerp, so it does not read the
 * layer's vertices; and the projection is `MercatorCoordinate.fromLngLat` —
 * maplibre-gl's own, the one the basemap is drawn with — rather than a second
 * spelling of `mercatorY`. An earlier version of this helper computed
 * `atan2(Δlat, Δlon)`, which is exactly the bug the implementation had, so
 * the suite was green while the icon was skewed by up to 8.4° on this route.
 *
 * `MercatorCoordinate`'s y grows southward and deck.gl's `getAngle` is y-up
 * with 0 = east, hence the negation.
 */
function courseAt(t: number, from: [number, number] = LPA, to: [number, number] = YVR): number {
  const eps = 0.0005;
  const a = interpolateGreatCircle(from, to, t - eps);
  const b = interpolateGreatCircle(from, to, t + eps);
  const pa = MercatorCoordinate.fromLngLat({ lng: a[0], lat: a[1] });
  const pb = MercatorCoordinate.fromLngLat({ lng: b[0], lat: b[1] });
  return (Math.atan2(-(pb.y - pa.y), pb.x - pa.x) * 180) / Math.PI;
}

/** What the layer used to compute, kept so the regression can be named. */
function latSpaceCourseAt(t: number, from: [number, number] = LPA, to: [number, number] = YVR) {
  const eps = 0.0005;
  const a = interpolateGreatCircle(from, to, t - eps);
  const b = interpolateGreatCircle(from, to, t + eps);
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

describe("buildTripsData draws the route, not the chord", () => {
  const [trip] = buildTripsData([lpaYvr]);

  it("gives the trail the whole great circle, not two endpoints", () => {
    expect(trip.path.length).toBeGreaterThan(10);
    expect(trip.path[0]).toEqual(LPA);
    expect(trip.path[trip.path.length - 1]).toEqual(YVR);
  });

  it("carries one timestamp per vertex — TripsLayer pairs them by index", () => {
    expect(trip.timestamps).toHaveLength(trip.path.length);
    for (let i = 1; i < trip.timestamps.length; i++) {
      expect(trip.timestamps[i]).toBeGreaterThan(trip.timestamps[i - 1]);
    }
    expect(trip.timestamps[0]).toBe(T0);
    expect(trip.timestamps[trip.timestamps.length - 1]).toBe(T1);
  });

  it("keeps the departure and arrival times it was given", () => {
    // The vertices are evenly spaced along the arc, so an even time split is
    // a constant ground speed — which is the only speed profile the payload
    // supports. Nothing here invents a climb or a descent.
    const mid = trip.timestamps[(trip.timestamps.length - 1) / 2];
    expect(mid).toBeCloseTo((T0 + T1) / 2, 6);
  });
});

describe("planeAt samples the SAME path the trail draws", () => {
  const [trip] = buildTripsData([lpaYvr]);

  it("sits on the great-circle midpoint at half time, not the chord's", () => {
    const half = T0 + (T1 - T0) * 0.5;
    const plane = planeAt(trip, half);
    expect(plane).not.toBeNull();
    const expected = interpolateGreatCircle(LPA, YVR, 0.5);
    expect(plane?.position[0]).toBeCloseTo(expected[0], 3);
    expect(plane?.position[1]).toBeCloseTo(expected[1], 3);
    // And that midpoint is a long way north of the straight line — which is
    // the whole visible difference the owner reported.
    expect(plane?.position[1]).toBeGreaterThan((LPA[1] + YVR[1]) / 2 + 5);
  });

  it("points along the track as DRAWN, not along it in lon/lat space", () => {
    // Measured at a QUARTER of the way, not at the midpoint. A symmetric bow's
    // mid-tangent runs almost parallel to its own chord (1.6° apart here), so
    // the midpoint is where the POSITION separates the two and the heading
    // does not.
    const quarter = T0 + (T1 - T0) * 0.25;
    const plane = planeAt(trip, quarter);
    // Tolerance is one vertex of curvature: the heading comes from the segment
    // the plane is on (~2° of arc), the reference from a centred difference,
    // so the two differ by about half a segment's turn.
    expect(Math.abs((plane?.angleDeg ?? 0) - courseAt(0.25))).toBeLessThan(1.5);

    // …and NOT the lat-space answer, which is 8.3° away here. That number is
    // the whole point: a heading computed in lon/lat and rendered in Mercator
    // is the same class of mistake as a route drawn as a chord, one level
    // down. Hand-computed with `asinh(tan φ)`, a third spelling of the
    // projection: drawn 139.11°, lat-space 147.39°.
    expect(courseAt(0.25)).toBeCloseTo(139.11, 1);
    expect(latSpaceCourseAt(0.25)).toBeCloseTo(147.39, 1);
    expect(Math.abs((plane?.angleDeg ?? 0) - latSpaceCourseAt(0.25))).toBeGreaterThan(6);

    // Not the chord's bearing either, which is what "points at the
    // destination" would mean.
    const chordCourse = (Math.atan2(YVR[1] - LPA[1], YVR[0] - LPA[0]) * 180) / Math.PI;
    expect(Math.abs((plane?.angleDeg ?? 0) - chordCourse)).toBeGreaterThan(15);
  });

  it("holds on a NORTHERLY route, where the projection error is 26°", () => {
    // KEF→ANC crests at 77°N. Mercator stretches latitude by 1/cos(lat), so
    // the further north the leg, the further the old heading pointed from the
    // line it was sitting on: 141.28° drawn against 167.07° in lon/lat.
    const kefAnc = {
      ...lpaYvr,
      properties: {
        ...lpaYvr.properties,
        id: "north",
        departureAirport: { iata: "KEF", lat: KEF[1], lon: KEF[0] },
        arrivalAirport: { iata: "ANC", lat: ANC[1], lon: ANC[0] },
      },
      geometry: { type: "LineString", coordinates: [KEF, ANC] },
    } as unknown as GeoJSONFeature;
    const [north] = buildTripsData([kefAnc]);
    const plane = planeAt(north, T0 + (T1 - T0) * 0.25);
    expect(Math.abs((plane?.angleDeg ?? 0) - courseAt(0.25, KEF, ANC))).toBeLessThan(2.5);
    expect(courseAt(0.25, KEF, ANC)).toBeCloseTo(141.28, 1);
    expect(latSpaceCourseAt(0.25, KEF, ANC)).toBeCloseTo(167.07, 1);
  });

  it("turns as the flight progresses — a straight line would not", () => {
    // Wrap-aware: this route's course passes through 180° and comes out
    // negative, so a raw subtraction would report a 340° turn.
    const turn = (a: number, b: number): number => {
      const d = (((b - a) % 360) + 540) % 360;
      return Math.abs(d - 180);
    };
    const early = planeAt(trip, T0 + (T1 - T0) * 0.15)?.angleDeg ?? 0;
    const late = planeAt(trip, T0 + (T1 - T0) * 0.85)?.angleDeg ?? 0;
    expect(180 - turn(early, late)).toBeGreaterThan(10);
  });

  it("starts at the departure airport and ends at the arrival one", () => {
    expect(planeAt(trip, T0)?.position).toEqual(LPA);
    expect(planeAt(trip, T1)?.position).toEqual(YVR);
  });

  it("is absent before take-off and after landing — no parked plane on the map", () => {
    expect(planeAt(trip, T0 - 1)).toBeNull();
    expect(planeAt(trip, T1 + 1)).toBeNull();
  });

  // The abstention moved one level UP on 2026-09-20: `buildTripsData` used to
  // hand an undated flight a trip pinned to the epoch and `planeAt` declined
  // to place a plane on it. Now no trip is built at all, which is what keeps
  // the slider's minimum off 01.01.1970 (see `tripsLayer.test.ts`).
  it("abstains rather than guessing when a flight has no times at all", () => {
    const undated = {
      ...lpaYvr,
      properties: { ...lpaYvr.properties, departureTime: null, arrivalTime: null },
    } as unknown as GeoJSONFeature;
    expect(buildTripsData([undated])).toHaveLength(0);
  });
});

describe("buildPlaneData", () => {
  it("returns a plane only for the flights actually in the air", () => {
    const trips = buildTripsData([lpaYvr]);
    expect(buildPlaneData(trips, T0 + (T1 - T0) * 0.4)).toHaveLength(1);
    expect(buildPlaneData(trips, T1 + 3600)).toHaveLength(0);
  });
});

describe("getTimeRange survives the vertex count the great circle brought", () => {
  it("handles a set whose timestamps far exceed the argument limit of a spread", () => {
    // `Math.min(...all)` passes every timestamp as an ARGUMENT. Measured on
    // this engine: ~124 920 arguments and it throws RangeError. A flight used
    // to contribute 2 timestamps and now contributes 11–121, so the set grew
    // 5–60×: an account whose dashboard used to reach ~60 000 now reaches
    // well past the limit, and the whole trips mode would throw rather than
    // degrade. 2 000 flights is a real account; at 121 vertices that is
    // 242 000 values.
    const many: Array<{ path: [number, number][]; timestamps: number[] }> = [];
    for (let i = 0; i < 2000; i++) {
      const timestamps: number[] = [];
      for (let v = 0; v <= 120; v++) timestamps.push(1_700_000_000 + i * 1000 + v);
      many.push({ path: timestamps.map(() => [0, 0]), timestamps });
    }
    const range = getTimeRange(many);
    expect(range.min).toBe(1_700_000_000);
    expect(range.max).toBe(1_700_000_000 + 1999 * 1000 + 120);
  });

  it("still answers zeroes for an empty set rather than ±Infinity", () => {
    expect(getTimeRange([])).toEqual({ min: 0, max: 0 });
  });
});

describe("createPlaneLayer keeps its icon atlas between frames", () => {
  it("mounts with an empty data array when nothing is airborne", () => {
    // Returning null unmounted the IconLayer, and deck.gl re-rasterised the
    // SVG into a fresh atlas the next time one was in the air — a blink on
    // every gap while scrubbing the slider, and every gap is crossed twice.
    const trips = buildTripsData([lpaYvr]);
    const layer = createPlaneLayer(trips, T1 + 3600);
    expect(layer).not.toBeNull();
    expect((layer?.props as unknown as { data: unknown[] }).data).toEqual([]);
  });

  it("uses the same icon object across calls, so the atlas is not rebuilt", () => {
    const trips = buildTripsData([lpaYvr]);
    const a = createPlaneLayer(trips, T0 + (T1 - T0) * 0.3);
    const b = createPlaneLayer(trips, T0 + (T1 - T0) * 0.6);
    const iconOf = (l: typeof a): unknown =>
      (l?.props as unknown as { getIcon: () => unknown }).getIcon();
    expect(iconOf(a)).toBe(iconOf(b));
  });
});

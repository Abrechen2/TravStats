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
import { buildPlaneData, buildTripsData, planeAt } from "../../components/layers/tripsLayer";
import { interpolateGreatCircle } from "../../components/layers/greatCircle";
import type { GeoJSONFeature } from "../../types";

const LPA: [number, number] = [-15.3866, 27.9319];
const YVR: [number, number] = [-123.184, 49.1947];

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

/** Great-circle course at fraction `t`, from a centred finite difference on
 *  the slerp itself — deliberately NOT the layer's vertices. deck.gl's icon
 *  rotation is y-up with 0 = east (see `cruiseArcsLayer`'s note, verified in
 *  a browser), so the course is `atan2(dLat, dLon)`. */
function courseAt(t: number): number {
  const eps = 0.001;
  const a = interpolateGreatCircle(LPA, YVR, t - eps);
  const b = interpolateGreatCircle(LPA, YVR, t + eps);
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

  it("points along the track, not at the destination", () => {
    // Measured at a QUARTER of the way, not at the midpoint. A symmetric bow's
    // mid-tangent runs almost parallel to its own chord (1.6° apart here), so
    // the midpoint is where the POSITION separates the two and the heading
    // does not. A quarter in, the great-circle course is 147.4° against the
    // chord's 168.8° — a difference a viewer sees.
    const quarter = T0 + (T1 - T0) * 0.25;
    const plane = planeAt(trip, quarter);
    // Tolerance is one vertex of curvature: the heading comes from the segment
    // the plane is on (~2° of arc), the reference from a centred difference,
    // so the two differ by about half a segment's turn.
    expect(Math.abs((plane?.angleDeg ?? 0) - courseAt(0.25))).toBeLessThan(1.5);
    const chordCourse = (Math.atan2(YVR[1] - LPA[1], YVR[0] - LPA[0]) * 180) / Math.PI;
    expect(Math.abs((plane?.angleDeg ?? 0) - chordCourse)).toBeGreaterThan(15);
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

  it("abstains rather than guessing when a flight has no times at all", () => {
    const undated = {
      ...lpaYvr,
      properties: { ...lpaYvr.properties, departureTime: null, arrivalTime: null },
    } as unknown as GeoJSONFeature;
    const [t] = buildTripsData([undated]);
    expect(planeAt(t, 0)).toBeNull();
  });
});

describe("buildPlaneData", () => {
  it("returns a plane only for the flights actually in the air", () => {
    const trips = buildTripsData([lpaYvr]);
    expect(buildPlaneData(trips, T0 + (T1 - T0) * 0.4)).toHaveLength(1);
    expect(buildPlaneData(trips, T1 + 3600)).toHaveLength(0);
  });
});

// The reference here is MapLibre's OWN projection, not a second spelling of
// the formula under test.
//
// `screenTangentDeg` exists because two layers computed an icon's rotation
// from `atan2(Δlat, Δlon)`. deck.gl's `getAngle` rotates in SCREEN space, and
// the screen is Web Mercator, where a degree of latitude is worth
// `1/cos(lat)` degrees of longitude. The two agree only on the equator, and
// the error is a rotation nobody can see is wrong without a protractor: the
// arrow or the aeroplane simply points somewhere slightly beside its own
// line.
//
// A test that recomputed `ln(tan(π/4 + φ/2))` would be a copy of the rule and
// would pass just as happily on a wrong rule. `MercatorCoordinate.fromLngLat`
// is maplibre-gl's projection — the one the basemap is actually drawn with —
// so it can disagree.

import { describe, it, expect } from "vitest";
import { MercatorCoordinate } from "maplibre-gl";
import { mercatorY, screenTangentDeg } from "./screenTangent";

type LonLat = [number, number];

/**
 * The tangent as MapLibre would draw it.
 *
 * `MercatorCoordinate` is normalised to the unit square, so x and y share a
 * scale and the angle between them is the on-screen one. Its y grows
 * SOUTHWARD (0 at the north pole), while deck.gl's `getAngle` is y-up with
 * 0 = east — hence the negation, and nothing else.
 */
function maplibreTangentDeg(a: LonLat, b: LonLat): number {
  const pa = MercatorCoordinate.fromLngLat({ lng: a[0], lat: a[1] });
  const pb = MercatorCoordinate.fromLngLat({ lng: b[0], lat: b[1] });
  return (Math.atan2(-(pb.y - pa.y), pb.x - pa.x) * 180) / Math.PI;
}

/** What the two layers used to compute: the angle in raw lon/lat space. */
function latSpaceTangentDeg(a: LonLat, b: LonLat): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

const CASES: Array<{ name: string; from: LonLat; to: LonLat; latSpaceErrorDeg: number }> = [
  // Hand-computed with a THIRD formulation, `asinh(tan φ)`, which is the same
  // projection written a different way. The error column is what the old code
  // was off by on that leg.
  {
    name: "Barcelona → Civitavecchia",
    from: [2.17, 41.38],
    to: [11.8, 42.1],
    latSpaceErrorDeg: 1.4,
  },
  {
    name: "Reykjavík → Longyearbyen",
    from: [-21.94, 64.15],
    to: [15.63, 78.22],
    latSpaceErrorDeg: 30.1,
  },
  {
    name: "Quito → Nairobi (equatorial)",
    from: [-78.49, -0.18],
    to: [36.82, -1.29],
    latSpaceErrorDeg: 0,
  },
];

describe("screenTangentDeg agrees with the projection the map is drawn in", () => {
  for (const { name, from, to } of CASES) {
    it(`${name}`, () => {
      expect(screenTangentDeg(from, to)).toBeCloseTo(maplibreTangentDeg(from, to), 6);
    });
  }

  it("is NOT the lat-space angle, except on the equator where the two coincide", () => {
    for (const { name, from, to, latSpaceErrorDeg } of CASES) {
      const drift = Math.abs(screenTangentDeg(from, to) - latSpaceTangentDeg(from, to));
      expect(drift, `${name}: drift from the old lat-space angle`).toBeCloseTo(latSpaceErrorDeg, 0);
    }
  });

  it("leaves the two headings the convention was pinned on untouched", () => {
    // #160 pinned these: due east is 0 and due south is −90, never +90.
    // Mercator stretches y, which cannot move an angle that has no y
    // component or no x component — so the earlier browser verification of
    // the convention still stands.
    expect(screenTangentDeg([0, 0], [10, 0])).toBeCloseTo(0, 9);
    expect(screenTangentDeg([0, 10], [0, 0])).toBeCloseTo(-90, 9);
    expect(screenTangentDeg([0, 40], [0, 50])).toBeCloseTo(90, 9);
  });
});

describe("mercatorY", () => {
  it("matches maplibre's own y, up to the unit square's scale and sign", () => {
    // maplibre's y is (0.5 − mercatorY/360) — same projection, normalised and
    // flipped. Checking the relation rather than the value keeps this test
    // from being a restatement of the formula.
    for (const lat of [-60, -12.5, 0, 33.7, 71]) {
      const theirs = MercatorCoordinate.fromLngLat({ lng: 0, lat }).y;
      expect(0.5 - mercatorY(lat) / 360).toBeCloseTo(theirs, 9);
    }
  });

  it("stays finite at the poles instead of returning ±Infinity", () => {
    // Measured: the unclamped formula gives −Infinity at lat −90, and two such
    // vertices then differ by NaN — an angle of NaN rotates an icon to
    // nowhere. No renderer can show ±89.9 apart from ±90 anyway.
    expect(Number.isFinite(mercatorY(90))).toBe(true);
    expect(Number.isFinite(mercatorY(-90))).toBe(true);
    expect(Number.isFinite(screenTangentDeg([0, -90], [10, -90]))).toBe(true);
  });
});

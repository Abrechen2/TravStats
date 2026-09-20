// The flat map drew the "Bogen" shape as a MERCATOR CHORD.
//
// `flat` mode has followed the great circle since #183 (greatCircle.ts, and
// the FRA-JFK test beside it), and the globe pre-tessellates one per arc
// (Globe/arcUtils.greatCircleWaypoints). Only the default shape — the one
// almost everybody is looking at — ran deck.gl's ArcLayer with
// `greatCircle` left at its `false` default, which interpolates in lon/lat
// space. LPA→YVR came out as a straight line across the Atlantic, which is
// not a route any aircraft has ever flown, and it disagreed with the other
// two renderers of the same data on the same screen.
//
// What can and cannot be checked here: deck.gl tessellates an ArcLayer in the
// VERTEX SHADER, so there is no CPU-side path to read and jsdom runs no GL.
// These tests therefore pin (a) the prop, on all three arc layers, (b) that
// the geometry the prop selects is genuinely not a chord — proved on the CPU
// with the project's own slerp, which is the same maths the shader runs — and
// (c) the shader contract `UpcomingArcLayer`'s gradient depends on, because
// that is the thing most likely to break silently. What no test here can say
// is what the map looks like; that needs a browser.

import { describe, it, expect } from "vitest";
import { ArcLayer } from "@deck.gl/layers";
import { buildRouteData, createRoutesLayers } from "./routesLayer";
import { UpcomingArcLayer } from "./UpcomingArcLayer";
import { interpolateGreatCircle } from "./greatCircle";
import { FLAT_ROUTES_LAYER_ID } from "./flatRoutesLayer";
import type { GeoJSONFeature } from "../../types";

const LPA: [number, number] = [-15.3866, 27.9319];
const YVR: [number, number] = [-123.184, 49.1947];

function flight(id: string, status: string): GeoJSONFeature {
  return {
    type: "Feature",
    properties: {
      id,
      airline: "AC",
      flightNumber: "AC1",
      departureAirport: { iata: "LPA", name: "Gran Canaria", lat: LPA[1], lon: LPA[0] },
      arrivalAirport: { iata: "YVR", name: "Vancouver", lat: YVR[1], lon: YVR[0] },
      departureTime: "2024-05-01T08:00:00Z",
      arrivalTime: "2024-05-01T19:00:00Z",
      status,
      distance: 7800,
    },
    geometry: { type: "LineString", coordinates: [LPA, YVR] },
  } as unknown as GeoJSONFeature;
}

/** One flown and one scheduled flight on the SAME pair makes that route
 *  "mixed", which is the only route that reaches `UpcomingArcLayer`. A second
 *  pair covers the plain and pure-scheduled layers. */
const flights: GeoJSONFeature[] = [
  flight("flown", "flown"),
  flight("upcoming", "scheduled"),
  {
    ...flight("other", "scheduled"),
    properties: {
      ...flight("other", "scheduled").properties,
      id: "other",
      departureAirport: { iata: "MUC", name: "Munich", lat: 48.35, lon: 11.79 },
      arrivalAirport: { iata: "KEF", name: "Keflavik", lat: 63.99, lon: -22.61 },
    },
  } as unknown as GeoJSONFeature,
];

function arcLayers(): ArcLayer[] {
  return createRoutesLayers(buildRouteData(flights, 1)).filter(
    (l): l is ArcLayer => l instanceof ArcLayer
  ) as ArcLayer[];
}

describe("the 2D map's arcs are great circles", () => {
  it("mounts all three arc layers — otherwise the sweep below proves nothing", () => {
    const ids = arcLayers().map((l) => l.id);
    expect(ids).toEqual(["routes-arc", "routes-arc-scheduled", "routes-arc-upcoming"]);
  });

  it("sets greatCircle on every one of them, the tipped one included", () => {
    for (const layer of arcLayers()) {
      expect(
        (layer.props as unknown as { greatCircle?: boolean }).greatCircle,
        `${layer.id} still interpolates in lon/lat space`
      ).toBe(true);
    }
  });

  it("does not touch the flat shape, which already followed the great circle", () => {
    const ids = createRoutesLayers(
      buildRouteData(flights, 1),
      undefined,
      undefined,
      0.3,
      [],
      undefined,
      2,
      { routeShape: "flat" }
    ).map((l) => l.id);
    expect(ids).toContain(FLAT_ROUTES_LAYER_ID);
    expect(ids).not.toContain("routes-arc");
  });

  it("keeps a raised bow in arc mode — 'Bogen' is a raised great circle, not a flat one", () => {
    const layers = createRoutesLayers(buildRouteData(flights, 1), undefined, undefined, 0.3).filter(
      (l): l is ArcLayer => l instanceof ArcLayer
    );
    for (const layer of layers) {
      expect((layer.props as unknown as { getHeight?: number }).getHeight).toBe(0.3);
    }
  });

  it("selects a curve, not a chord: LPA→YVR's midpoint is far north of the straight line", () => {
    // The shader's `interpolateGreatCircle` and this module's are the same
    // slerp; the GPU runs one per vertex, and jsdom cannot. So the claim
    // "greatCircle is not a chord" is measured here, on the maths.
    const mid = interpolateGreatCircle(LPA, YVR, 0.5);
    const chordMidLat = (LPA[1] + YVR[1]) / 2;
    expect(mid[1]).toBeGreaterThan(chordMidLat + 5);
  });
});

/**
 * `getShaders()` reads `this.context.defaultShaderModules`, which deck.gl only
 * populates once a layer is mounted on a live deck instance. Handing it an
 * empty list is enough to get the SOURCE out, which is all these tests read.
 */
function shadersOf(layer: ArcLayer): { vs?: string; inject?: Record<string, string> } {
  (layer as unknown as { context: unknown }).context = { defaultShaderModules: [] };
  return layer.getShaders();
}

describe("UpcomingArcLayer's gradient survives greatCircle", () => {
  const shaders = shadersOf(new UpcomingArcLayer({ edgeColor: [1, 2, 3] }));

  it("still paints the tips from the arc's own segment ratio", () => {
    const inject = (shaders.inject ?? {})["fs:DECKGL_FILTER_COLOR"] ?? "";
    expect(inject).toContain("geometry.uv.x");
  });

  it("gets that ratio from a uv the shader writes BEFORE it branches on greatCircle", () => {
    // This is the whole reason the gradient is unaffected. ArcLayer assigns
    // `uv = vec2(segmentRatio, segmentSide); geometry.uv = uv;` above
    // `if ((arc.greatCircle || project.projectionMode == PROJECTION_MODE_GLOBE)`,
    // so uv.x means "how far along this arc" in both branches. If a deck.gl
    // upgrade ever moves that assignment into the branches, the tips would
    // silently stop fading and this test is what says so.
    const vs = shaders.vs ?? "";
    const uvAt = vs.indexOf("geometry.uv = uv;");
    const branchAt = vs.indexOf("arc.greatCircle");
    expect(uvAt, "ArcLayer no longer writes geometry.uv").toBeGreaterThan(-1);
    expect(branchAt, "ArcLayer no longer branches on greatCircle").toBeGreaterThan(-1);
    expect(uvAt).toBeLessThan(branchAt);
  });

  it("computes the bow from the great-circle distance in that branch", () => {
    // The height formula changes with the flag: the flat branch measures the
    // chord in Mercator common space, the great-circle branch measures the
    // real angular distance. That is why the same `getHeight` yields a
    // slightly lower bow for a long high-latitude route than it used to — the
    // bow now tracks the distance flown rather than how far Mercator stretched
    // the map at that latitude.
    const vs = shadersOf(new ArcLayer({})).vs ?? "";
    expect(vs).toContain("paraboloid(angularDist * EARTH_RADIUS");
  });
});

import { describe, it, expect } from "vitest";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import {
  buildTripMapGlobeLayers,
  toGlobeLabelPoints,
  type TripCruisePath,
  type TripFlightArc,
  type TripPointDatum,
} from "../TripMapGlobeLayers";
import { EarthOcclusionExtension } from "../../Globe/EarthOcclusionExtension";
import { CRUISE_PATH_ALTITUDE_M, MARKER_ALTITUDE_M } from "../../Globe/buildGlobeLayers";

/**
 * The trip map is the THIRD renderer in this app, and until now its globe
 * toggle drew nothing: the MUC↔KEF arc and every stop label vanished the
 * moment the projection flipped. The three causes were all things the
 * dashboard globe had already written down — `ArcLayer.greatCircle` does not
 * render under globe projection (Globe/buildGlobeLayers.ts), a billboard
 * TextLayer does not either (Globe/GlobeLabelsOverlay.tsx), and an overlay
 * without horizon clipping bleeds the far side of the planet through the near
 * one (Globe/EarthOcclusionExtension.ts).
 *
 * These tests pin the SHAPE of the globe stack. They cannot say it looks
 * right — jsdom has no WebGL and never draws a pixel — so the browser look is
 * still the acceptance. What they can say is that the stack is built out of
 * the globe modules rather than beside them.
 */

// Gran Canaria → Vancouver: 7 800 km with 108° of longitude between the
// endpoints, so its great circle bows far enough north of the lon/lat chord
// that the difference is measurable rather than a rounding artefact.
const LPA: [number, number] = [-15.3866, 27.9319];
const YVR: [number, number] = [-123.184, 49.1947];

const ORANGE: [number, number, number] = [240, 169, 71];
const BLUE: [number, number, number] = [111, 160, 214];

const flightArc: TripFlightArc = {
  flightId: "f1",
  source: LPA,
  target: YVR,
  label: "LPA → YVR",
  color: ORANGE,
};

const cruisePath: TripCruisePath = {
  cruiseId: "c1",
  path: [
    [12.34, 45.43],
    [14.51, 35.9],
    [23.63, 37.94],
  ],
  label: "AIDA",
  color: BLUE,
};

const airport: TripPointDatum = {
  position: LPA,
  label: "LPA",
  color: ORANGE,
  radiusMeters: 30_000,
  kind: "airport",
};

const stop: TripPointDatum = {
  position: [13.4, 52.52],
  label: "Berlin",
  color: BLUE,
  radiusMeters: 60_000,
  kind: "stop",
};

function build(overrides: Partial<Parameters<typeof buildTripMapGlobeLayers>[0]> = {}): Layer[] {
  return buildTripMapGlobeLayers({
    flightArcs: [flightArc],
    cruisePaths: [cruisePath],
    tourPaths: [],
    airportPoints: [airport],
    stopPoints: [stop],
    lodgingPoints: [],
    occlusionExt: new EarthOcclusionExtension(),
    occlusionProps: { earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 },
    ...overrides,
  });
}

function layerById(layers: Layer[], id: string): Layer {
  const found = layers.find((l) => l.id === id);
  expect(found, `no layer with id ${id}`).toBeDefined();
  return found as Layer;
}

describe("buildTripMapGlobeLayers: flight arcs", () => {
  it("draws flights as a PathLayer, not an ArcLayer — greatCircle is broken under globe projection", () => {
    const arcs = layerById(build(), "trip-flight-arcs");
    expect(arcs).toBeInstanceOf(PathLayer);
  });

  it("pre-tessellates the great circle instead of handing deck.gl two endpoints", () => {
    const arcs = layerById(build(), "trip-flight-arcs");
    const path = (
      arcs.props as unknown as { data: TripFlightArc[]; getPath: (d: TripFlightArc) => number[][] }
    ).getPath(flightArc);
    expect(path.length).toBeGreaterThan(2);
    // Endpoints are passed through verbatim so the arc meets its airport dot.
    expect(path[0][0]).toBeCloseTo(LPA[0], 6);
    expect(path[0][1]).toBeCloseTo(LPA[1], 6);
    expect(path[path.length - 1][0]).toBeCloseTo(YVR[0], 6);
    expect(path[path.length - 1][1]).toBeCloseTo(YVR[1], 6);
  });

  it("puts the LPA→YVR midpoint north of the lon/lat chord — the whole point of a great circle", () => {
    const arcs = layerById(build(), "trip-flight-arcs");
    const path = (arcs.props as unknown as { getPath: (d: TripFlightArc) => number[][] }).getPath(
      flightArc
    );
    const mid = path[Math.floor(path.length / 2)];
    const chordMidLat = (LPA[1] + YVR[1]) / 2;
    expect(mid[1]).toBeGreaterThan(chordMidLat + 5);
  });

  it("bows the path radially off the sphere — a flat path on a globe reads as a scar", () => {
    const arcs = layerById(build(), "trip-flight-arcs");
    const path = (arcs.props as unknown as { getPath: (d: TripFlightArc) => number[][] }).getPath(
      flightArc
    );
    const peak = Math.max(...path.map((p) => p[2]));
    expect(peak).toBeGreaterThan(0);
    // Endpoints sit on the surface; only the middle lifts. The profile is
    // peak*sin(pi*t), so the ends land within float noise of zero, not on it.
    expect(path[0][2]).toBeCloseTo(0, 6);
    expect(path[path.length - 1][2]).toBeCloseTo(0, 6);
  });

  it("keeps longitudes unwrapped, so an antimeridian crossing is not drawn the long way round", () => {
    const arcs = layerById(build(), "trip-flight-arcs");
    expect((arcs.props as unknown as { wrapLongitude?: boolean }).wrapLongitude).toBe(false);
  });
});

describe("buildTripMapGlobeLayers: cruise legs", () => {
  it("lifts the leg to the globe's cruise altitude so it does not z-fight the sphere", () => {
    const paths = layerById(build(), "trip-cruise-paths");
    expect(paths).toBeInstanceOf(PathLayer);
    const path = (paths.props as unknown as { getPath: (d: TripCruisePath) => number[][] }).getPath(
      cruisePath
    );
    expect(path).toHaveLength(cruisePath.path.length);
    for (const p of path) expect(p[2]).toBe(CRUISE_PATH_ALTITUDE_M);
  });
});

describe("buildTripMapGlobeLayers: markers", () => {
  it("lifts markers above the cruise altitude, as the dashboard globe does", () => {
    const airports = layerById(build(), "trip-airports");
    expect(airports).toBeInstanceOf(ScatterplotLayer);
    const pos = (
      airports.props as unknown as { getPosition: (d: TripPointDatum) => number[] }
    ).getPosition(airport);
    expect(pos[2]).toBe(MARKER_ALTITUDE_M);
    expect(MARKER_ALTITUDE_M).toBeGreaterThan(CRUISE_PATH_ALTITUDE_M);
  });

  it("sizes markers in pixels — a metre radius balloons into a continent at globe zoom", () => {
    const airports = layerById(build(), "trip-airports");
    expect((airports.props as unknown as { radiusUnits?: string }).radiusUnits).toBe("pixels");
  });
});

describe("buildTripMapGlobeLayers: horizon", () => {
  it("clips every layer at the horizon — without it the far side bleeds through", () => {
    for (const layer of build({ tourPaths: [], lodgingPoints: [stop] })) {
      const extensions = (layer.props as unknown as { extensions?: unknown[] }).extensions ?? [];
      expect(
        extensions.some((e) => e instanceof EarthOcclusionExtension),
        `${layer.id} has no EarthOcclusionExtension`
      ).toBe(true);
    }
  });
});

describe("buildTripMapGlobeLayers: labels", () => {
  it("draws no TextLayer — a deck.gl billboard does not render under globe projection", () => {
    for (const layer of build()) {
      expect(layer, `${layer.id} is a TextLayer`).not.toBeInstanceOf(TextLayer);
    }
  });

  it("hands the label text to the globe's HTML overlay instead", () => {
    const points = toGlobeLabelPoints([airport, stop]);
    expect(points.map((p) => p.label)).toEqual(["LPA", "Berlin"]);
    expect(points[0].position).toEqual(LPA);
  });

  it("drops a point with no name rather than drawing an empty pill", () => {
    expect(toGlobeLabelPoints([{ ...airport, label: "" }])).toEqual([]);
  });
});

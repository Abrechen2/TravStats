// forgejo#312 — while the map option is on, a recorded flight is drawn along
// its recording BESIDE its route's great-circle arc, on the flat map (both
// route shapes) and on the globe, in the colour the user's flight-colour mode
// gives its route, thin rather than as wide as the route's frequency.

import { describe, expect, it } from "vitest";

import { buildRouteData, createRoutesLayers } from "./routesLayer";
import {
  RECORDED_ROUTES_LAYER_ID,
  RECORDED_GAP_DASH,
  recordedTrackFromLine,
  withRecordedPaths,
} from "./recordedFlightPaths";
import { buildGlobeArcData } from "../Globe/globeArcData";
import { DEFAULT_FLIGHT_COLORS, type FlightColorConfig } from "../../lib/flightColor";
import type { GeoJSONFeature } from "../../types";
import type { Layer } from "@deck.gl/core";

const statusCfg: FlightColorConfig = {
  mode: "status",
  colors: { ...DEFAULT_FLIGHT_COLORS, past: [10, 200, 30] },
};

const MUC: [number, number] = [11.79, 48.35];
const FRA: [number, number] = [8.57, 50.03];

function feat(id: string, status = "flown"): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [MUC, FRA] },
    properties: {
      id,
      status,
      departureTime: "2024-01-01T00:00:00Z",
      departureAirport: { iata: "MUC", name: "Munich" },
      arrivalAirport: { iata: "FRA", name: "Frankfurt" },
    },
  } as unknown as GeoJSONFeature;
}

const RECORDING: Array<[number, number]> = [MUC, [10.5, 49], [9.9, 49.4], [9.2, 49.8], FRA];

const recorded = (id: string): GeoJSONFeature =>
  withRecordedPaths([feat(id)], [{ flightId: id, geometry: RECORDING, segmentStarts: [0, 2] }])[0];

describe("recordedTrackFromLine", () => {
  it("draws the measured stretches solid and the hole between them as a connector", () => {
    expect(
      recordedTrackFromLine({ flightId: "f", geometry: RECORDING, segmentStarts: [0, 2] })
    ).toEqual({
      solid: [RECORDING.slice(0, 2), RECORDING.slice(2)],
      gaps: [RECORDING.slice(1, 3)],
    });
  });

  it("keeps a stretch of one fix — it is joined by a connector, not dropped", () => {
    expect(
      recordedTrackFromLine({ flightId: "f", geometry: RECORDING, segmentStarts: [0, 4] })
    ).toEqual({ solid: [RECORDING.slice(0, 4)], gaps: [RECORDING.slice(3)] });
  });
});

describe("withRecordedPaths", () => {
  it("gives the recording to its own flight only and leaves the others untouched", () => {
    const a = feat("a");
    const b = feat("b");
    const [outA, outB] = withRecordedPaths(
      [a, b],
      [{ flightId: "a", geometry: RECORDING, segmentStarts: [0] }]
    );
    expect(outA.properties.recordedTrack).toEqual({ solid: [RECORDING], gaps: [] });
    expect(outA).not.toBe(a);
    expect(a.properties.recordedTrack).toBeUndefined();
    expect(outB).toBe(b);
  });
});

const layersOf = (flights: GeoJSONFeature[], shape: "arc" | "flat" = "arc"): Layer[] =>
  createRoutesLayers(
    buildRouteData(flights, 1, statusCfg),
    undefined,
    undefined,
    1,
    [],
    undefined,
    5,
    { routeShape: shape },
    statusCfg
  );

describe("the flat map", () => {
  it("keeps the arc of a route whose only flight was recorded, and draws the recording beside it", () => {
    const data = buildRouteData([recorded("a")], 1, statusCfg);
    expect(data.arcs).toHaveLength(1);
    expect(data.arcs[0].flightIds).toEqual(["a"]);
    expect(data.recorded?.filter((r) => !r.gap).map((r) => r.path)).toEqual([
      RECORDING.slice(0, 2),
      RECORDING.slice(2),
    ]);
    expect(data.recorded?.filter((r) => r.gap).map((r) => r.path)).toEqual([RECORDING.slice(1, 3)]);
    expect(data.recorded?.[0].flightIds).toEqual(["a"]);
  });

  it("colours the recording exactly as its route's arc", () => {
    const arc = buildRouteData([feat("a")], 1, statusCfg).arcs[0];
    const line = buildRouteData([recorded("a")], 1, statusCfg).recorded?.[0];
    expect(line?.sourceColor).toEqual(arc.sourceColor);
  });

  it("keeps one aggregated arc for the route, recorded flights included", () => {
    const data = buildRouteData([recorded("a"), feat("b")], 1, statusCfg);
    expect(data.arcs).toHaveLength(1);
    expect(data.arcs[0].flightIds).toEqual(["a", "b"]);
    expect(data.arcs[0].count).toBe(2);
    expect(data.recorded?.every((r) => r.flightIds.join() === "a")).toBe(true);
  });

  it.each(["arc", "flat"] as const)(
    "adds the recorded layer in the %s shape, beside the arcs",
    (shape) => {
      const ids = (flights: GeoJSONFeature[]) => layersOf(flights, shape).map((l) => l.id);
      const withRecording = ids([recorded("a")]);
      expect(withRecording).toContain(RECORDED_ROUTES_LAYER_ID);
      // The arc layers are the same stack with or without the recording.
      expect(withRecording.filter((id) => id !== RECORDED_ROUTES_LAYER_ID)).toEqual(
        ids([feat("a")])
      );
      // Nothing recorded (the option off): the layer stack is the one that shipped before.
      expect(ids([feat("a")])).not.toContain(RECORDED_ROUTES_LAYER_ID);
    }
  );

  it("draws a recording thin and the same for a busy route as for a single flight", () => {
    const busy = [recorded("a"), ...Array.from({ length: 15 }, (_, i) => feat(`b${i}`))];
    const widthOf = (flights: GeoJSONFeature[], gap: boolean): number => {
      const layer = layersOf(flights).find((l) => l.id === RECORDED_ROUTES_LAYER_ID)!;
      const props = layer.props as unknown as {
        data: Array<{ gap: boolean }>;
        getWidth: (d: unknown) => number;
      };
      return props.getWidth(props.data.find((d) => d.gap === gap));
    };
    expect(widthOf(busy, false)).toBe(widthOf([recorded("a")], false));
    expect(widthOf(busy, true)).toBeLessThan(widthOf(busy, false));
  });

  it("dashes the connector across a hole and fades it, and draws the stretches solid", () => {
    const layer = layersOf([recorded("a")]).find((l) => l.id === RECORDED_ROUTES_LAYER_ID)!;
    const props = layer.props as unknown as {
      data: Array<{ gap: boolean }>;
      getDashArray: (d: unknown) => number[];
      getColor: (d: unknown) => number[];
    };
    const solid = props.data.find((d) => !d.gap);
    const gap = props.data.find((d) => d.gap);
    expect(props.getDashArray(gap)).toEqual(RECORDED_GAP_DASH);
    expect(props.getDashArray(solid)).toEqual([0, 0]);
    expect(props.getColor(gap)[3]).toBeLessThan(props.getColor(solid)[3]);
  });
});

describe("the globe", () => {
  it("draws a recording on the surface beside the route's great-circle arc", () => {
    const { arcsData, antipodalArcs } = buildGlobeArcData([recorded("a")], 1, false, 1);
    expect(antipodalArcs).toHaveLength(0);
    const lines = arcsData.filter((d) => d.recorded);
    expect(lines.filter((d) => d.recorded === "solid").map((d) => d.waypoints)).toEqual([
      RECORDING.slice(0, 2).map(([lon, lat]) => [lon, lat, 0]),
      RECORDING.slice(2).map(([lon, lat]) => [lon, lat, 0]),
    ]);
    expect(lines.filter((d) => d.recorded === "gap")).toHaveLength(1);
    expect(lines[0].flightIds).toEqual(["a"]);
    // The arc stays, even with every flight on the route recorded.
    expect(arcsData.filter((d) => !d.recorded)).toHaveLength(1);
  });

  it("keeps one great-circle arc for the route, in the recording's colour tier", () => {
    const { arcsData } = buildGlobeArcData([recorded("a"), feat("b")], 1, false, 1);
    const arcs = arcsData.filter((d) => !d.recorded);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].flightIds).toEqual(["a", "b"]);
    // Same route, same colour bucket: the recording does not change the route's tier.
    expect(new Set(arcsData.map((d) => d.quartile)).size).toBe(1);
  });

  it("unwraps a recording across the antimeridian so the globe does not draw it around the planet", () => {
    // The globe's PathLayer runs with wrapLongitude: false, so a raw 179 → -179
    // step would be a stroke 358° the other way round.
    const crossing: Array<[number, number]> = [
      [178.5, 50],
      [179.5, 50.2],
      [-179.5, 50.4],
      [-178.5, 50.6],
    ];
    const flight = withRecordedPaths(
      [feat("p")],
      [{ flightId: "p", geometry: crossing, segmentStarts: [0, 2] }]
    )[0];
    const { arcsData } = buildGlobeArcData([flight], 1, false, 1);
    const lines = arcsData.filter((d) => d.recorded);
    expect(lines.map((d) => d.waypoints.map((w) => w[0]))).toEqual([
      [178.5, 179.5],
      [180.5, 181.5],
      [179.5, 180.5],
    ]);
  });
});

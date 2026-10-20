// forgejo#312 — a flight with a recorded track is drawn along the recording
// instead of the great circle, on the flat map (both route shapes) and on the
// globe, in the colour the user's flight-colour mode gives its route.

import { describe, expect, it } from "vitest";

import { buildRouteData, createRoutesLayers } from "./routesLayer";
import {
  RECORDED_ROUTES_LAYER_ID,
  recordedPathsFromLine,
  withRecordedPaths,
} from "./recordedFlightPaths";
import { buildGlobeArcData } from "../Globe/globeArcData";
import { DEFAULT_FLIGHT_COLORS, type FlightColorConfig } from "../../lib/flightColor";
import type { GeoJSONFeature } from "../../types";

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

describe("recordedPathsFromLine", () => {
  it("cuts the line at each recorded stretch so a hole is never drawn", () => {
    expect(
      recordedPathsFromLine({ flightId: "f", geometry: RECORDING, segmentStarts: [0, 2] })
    ).toEqual([RECORDING.slice(0, 2), RECORDING.slice(2)]);
  });

  it("drops a stretch of one point — it is no line", () => {
    expect(
      recordedPathsFromLine({ flightId: "f", geometry: RECORDING, segmentStarts: [0, 4] })
    ).toEqual([RECORDING.slice(0, 4)]);
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
    expect(outA.properties.recordedPaths).toEqual([RECORDING]);
    expect(outA).not.toBe(a);
    expect(a.properties.recordedPaths).toBeUndefined();
    expect(outB).toBe(b);
  });
});

describe("the flat map", () => {
  it("draws a route whose only flight was recorded along the recording, with no arc", () => {
    const data = buildRouteData([recorded("a")], 1, statusCfg);
    expect(data.arcs).toHaveLength(0);
    expect(data.recorded?.map((r) => r.path)).toEqual([RECORDING.slice(0, 2), RECORDING.slice(2)]);
    expect(data.recorded?.[0].flightIds).toEqual(["a"]);
  });

  it("colours the recording exactly as the arc it replaces", () => {
    const arc = buildRouteData([feat("a")], 1, statusCfg).arcs[0];
    const line = buildRouteData([recorded("a")], 1, statusCfg).recorded?.[0];
    expect(line?.sourceColor).toEqual(arc.sourceColor);
  });

  it("keeps the arc while another flight on the route has no recording", () => {
    const data = buildRouteData([recorded("a"), feat("b")], 1, statusCfg);
    expect(data.arcs).toHaveLength(1);
    expect(data.arcs[0].flightIds).toEqual(["a", "b"]);
    expect(data.arcs[0].count).toBe(2);
    expect(data.recorded?.every((r) => r.flightIds.join() === "a")).toBe(true);
  });

  it.each(["arc", "flat"] as const)("adds the recorded layer in the %s shape", (shape) => {
    const ids = (flights: GeoJSONFeature[]) =>
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
      ).map((l) => l.id);
    expect(ids([recorded("a")])).toContain(RECORDED_ROUTES_LAYER_ID);
    // Nothing recorded: the layer stack is the one that shipped before.
    expect(ids([feat("a")])).not.toContain(RECORDED_ROUTES_LAYER_ID);
  });
});

describe("the globe", () => {
  it("draws a recorded route on the surface along the recording, not on the great circle", () => {
    const { arcsData, antipodalArcs } = buildGlobeArcData([recorded("a")], 1, false, 1);
    expect(antipodalArcs).toHaveLength(0);
    expect(arcsData.map((d) => d.waypoints)).toEqual([
      RECORDING.slice(0, 2).map(([lon, lat]) => [lon, lat, 0]),
      RECORDING.slice(2).map(([lon, lat]) => [lon, lat, 0]),
    ]);
    expect(arcsData[0].flightIds).toEqual(["a"]);
  });

  it("keeps the great-circle arc while another flight on the route has no recording", () => {
    const { arcsData } = buildGlobeArcData([recorded("a"), feat("b")], 1, false, 1);
    const arcs = arcsData.filter((d) => d.flightIds.length === 2);
    expect(arcs).toHaveLength(1);
    expect(arcsData).toHaveLength(3);
    // Same route, same colour bucket: the recording does not change the route's tier.
    expect(new Set(arcsData.map((d) => d.quartile)).size).toBe(1);
  });
});

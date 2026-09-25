import { describe, it, expect } from "vitest";
import type { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import {
  buildRailDeckLayers,
  buildRailPaths,
  buildRailStations,
  RAIL_PATH_GLOBE_ALTITUDE_M,
  type RailPathDatum,
  type RailStationDatum,
} from "../railPathsLayer";
import { makeRailJourney } from "../../rail/__tests__/railJourneyFixture";

/**
 * The one rail layer the detail map, the rail tab and the "Alle" map share
 * (spec 2026-09-25-rail-domain, phase 2b).
 */
describe("railPathsLayer", () => {
  const traced = makeRailJourney();
  const straight = makeRailJourney({ id: "j2", geometry: null, geometrySource: "straight" });

  it("draws the frozen line when there is one, and says so", () => {
    const [path] = buildRailPaths([traced]);
    expect(path.traced).toBe(true);
    expect(path.path).toEqual(traced.geometry);
  });

  it("falls back to the great circle between the stations, marked as a chord", () => {
    const [path] = buildRailPaths([straight]);
    expect(path.traced).toBe(false);
    expect(path.path[0]).toEqual([straight.depLon, straight.depLat]);
    expect(path.path[path.path.length - 1]).toEqual([straight.arrLon, straight.arrLat]);
    expect(path.path.length).toBeGreaterThan(2);
  });

  it("draws no line for a cancelled train, which never ran", () => {
    expect(buildRailPaths([{ ...traced, status: "cancelled" }])).toEqual([]);
    expect(buildRailStations([{ ...traced, status: "cancelled" }])).toEqual([]);
  });

  it("names each station once, however many rides touch it", () => {
    expect(buildRailStations([traced, { ...traced, id: "again" }])).toHaveLength(2);
  });

  it("paints in the colour it is given, lighter for a chord", () => {
    const layers = buildRailDeckLayers(buildRailPaths([traced, straight]), [], {
      color: [1, 2, 3],
    });
    const paths = layers[0] as PathLayer<RailPathDatum>;
    const getColor = paths.props.getColor as unknown as (d: RailPathDatum) => number[];
    const [tracedDatum, chordDatum] = paths.props.data as RailPathDatum[];
    expect(getColor(tracedDatum)).toEqual([1, 2, 3, 255]);
    expect(getColor(chordDatum)).toEqual([1, 2, 3, 170]);
  });

  it("lifts the line and the stations off the sphere on the globe", () => {
    const stations = buildRailStations([traced]);
    const [paths, dots] = buildRailDeckLayers(buildRailPaths([traced]), stations, {
      color: [1, 2, 3],
      altitudeM: RAIL_PATH_GLOBE_ALTITUDE_M,
    }) as [PathLayer<RailPathDatum>, ScatterplotLayer<RailStationDatum>];
    const getPath = paths.props.getPath as unknown as (d: RailPathDatum) => number[][];
    expect(getPath(buildRailPaths([traced])[0])[0][2]).toBe(RAIL_PATH_GLOBE_ALTITUDE_M);
    const getPosition = dots.props.getPosition as unknown as (d: RailStationDatum) => number[];
    expect(getPosition(stations[0])[2]).toBe(RAIL_PATH_GLOBE_ALTITUDE_M);
  });

  it("draws nothing for no rides", () => {
    expect(buildRailDeckLayers([], [], { color: [1, 2, 3] })).toEqual([]);
  });
});

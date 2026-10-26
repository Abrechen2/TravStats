import { describe, expect, it } from "vitest";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { withStationLabels } from "../labelObstacles";
import {
  buildStationLabelLayers,
  selectStationLabels,
  StationLabelsLayer,
  type StationLabelSource,
} from "../../layers/stationLabelsLayer";

/**
 * forgejo#320 on the trip map: rail, ferry and bus each build their own
 * station-name layer (`trip-rail`, `trip-ferry`, `trip-bus`), so each spaced
 * out only its own names — a train station and a bus terminal at one
 * interchange were printed over each other, which the dashboard's "Alle" map
 * had already ruled out by building one layer. The map now joins every
 * station-name layer it is handed into ONE pass, wherever they were built.
 */

const ride = (
  dep: string,
  depAt: [number, number],
  arr: string,
  arrAt: [number, number]
): StationLabelSource => ({
  status: "completed",
  depStationName: dep,
  arrStationName: arr,
  depLon: depAt[0],
  depLat: depAt[1],
  arrLon: arrAt[0],
  arrLat: arrAt[1],
});

// Hamburg Hbf and the ZOB beside it are 300 m apart — one interchange.
const HBF: [number, number] = [10.0069, 53.553];
const ZOB: [number, number] = [10.0105, 53.5521];
const KIEL: [number, number] = [10.1318, 54.3149];
const LUEBECK: [number, number] = [10.6698, 53.8676];
const PUTTGARDEN: [number, number] = [11.2245, 54.4997];
const ROEDBY: [number, number] = [11.3527, 54.6567];

const RAIL: [number, number, number] = [200, 30, 30];
const BUS: [number, number, number] = [30, 200, 30];
const FERRY: [number, number, number] = [30, 30, 200];

function tripExtras(): Layer[] {
  const line = new ScatterplotLayer({ id: "trip-rail-paths", data: [] });
  return [
    line,
    ...buildStationLabelLayers(
      [{ rides: [ride("Hamburg Hbf", HBF, "Kiel Hbf", KIEL)], color: RAIL }],
      { labelsMode: "important", idPrefix: "trip-rail" }
    ),
    ...buildStationLabelLayers(
      [{ rides: [ride("Puttgarden", PUTTGARDEN, "Rødby", ROEDBY)], color: FERRY }],
      { labelsMode: "important", idPrefix: "trip-ferry" }
    ),
    ...buildStationLabelLayers(
      [{ rides: [ride("Hamburg ZOB", ZOB, "Lübeck ZOB", LUEBECK)], color: BUS }],
      { labelsMode: "important", idPrefix: "trip-bus" }
    ),
  ];
}

const stationLayers = (layers: readonly Layer[]): StationLabelsLayer[] =>
  layers.filter((l): l is StationLabelsLayer => l instanceof StationLabelsLayer);

describe("station names from several builders share one pass", () => {
  it("joins the trip map's rail, ferry and bus names into one layer, keeping every domain's colour", () => {
    const out = withStationLabels([], tripExtras(), false);
    const joined = stationLayers(out);
    expect(joined).toHaveLength(1);
    const names = joined[0].props.data.map((d) => d.name).sort();
    expect(names).toEqual([
      "Hamburg Hbf",
      "Hamburg ZOB",
      "Kiel Hbf",
      "Lübeck ZOB",
      "Puttgarden",
      "Rødby",
    ]);
    const colour = (name: string) => joined[0].props.data.find((d) => d.name === name)?.color;
    expect(colour("Hamburg Hbf")).toEqual(RAIL);
    expect(colour("Hamburg ZOB")).toEqual(BUS);
    expect(colour("Rødby")).toEqual(FERRY);
  });

  it("names the interchange once at a regional zoom, not the station over the terminal", () => {
    const shown = stationLayers(withStationLabels([], tripExtras(), false))
      .flatMap((layer) => selectStationLabels(layer.props.data, "important", 9))
      .map((d) => d.name);
    const hamburg = shown.filter((n) => n.startsWith("Hamburg"));
    expect(hamburg).toHaveLength(1);
  });

  it("draws the joined names above every line, where the last name layer stood", () => {
    const out = withStationLabels([], tripExtras(), false);
    expect(out[0].id).toBe("trip-rail-paths");
    expect(out[out.length - 1]).toBeInstanceOf(StationLabelsLayer);
  });

  it("joins them on the globe too, so the HTML overlay gets each name once", () => {
    const joined = stationLayers(withStationLabels([], tripExtras(), true));
    expect(joined).toHaveLength(1);
    expect(joined[0].props.onGlobe).toBe(true);
    expect(joined[0].props.data).toHaveLength(6);
  });

  it("keeps names apart that the user reveals differently", () => {
    const extras = [
      ...buildStationLabelLayers(
        [{ rides: [ride("Hamburg Hbf", HBF, "Kiel Hbf", KIEL)], color: RAIL }],
        { labelsMode: "important", idPrefix: "a" }
      ),
      ...buildStationLabelLayers(
        [{ rides: [ride("Hamburg ZOB", ZOB, "Lübeck ZOB", LUEBECK)], color: BUS }],
        { labelsMode: "all", idPrefix: "b" }
      ),
    ];
    expect(stationLayers(withStationLabels([], extras, false))).toHaveLength(2);
  });

  it("leaves a single name layer as it was", () => {
    const extras = buildStationLabelLayers(
      [{ rides: [ride("Hamburg Hbf", HBF, "Kiel Hbf", KIEL)], color: RAIL }],
      { labelsMode: "important", idPrefix: "trip-rail" }
    );
    const [only] = stationLayers(withStationLabels([], extras, false));
    expect(only.id).toBe("trip-rail-station-labels");
  });
});

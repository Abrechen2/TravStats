import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { greatCirclePath } from "./greatCircle";
import type { Rgb } from "../../lib/domainColor";
import type { RailJourney } from "../../types/rail";

/**
 * Rail journeys as deck.gl paths — one module for the detail map, the rail
 * dashboard tab and the "Alle" map, so a train ride looks the same wherever it
 * is drawn (spec 2026-09-25-rail-domain, phase 2b).
 *
 * The line is the one frozen with the journey (`geometry`, `[lon, lat]`)
 * when there is one, else the great circle between the two stations. Which of
 * the two a path is travels with it as `traced`: a chord stands in for a
 * measurement, so it is drawn lighter and thinner — the same claim about the
 * DATA the tour layer makes for an unrouted leg. The colour is never decided
 * here; the caller passes the one it resolved from the domain colour store.
 */

/** What a path needs from a journey — structural, so a trip's slim rows fit too. */
export type RailPathSource = Pick<
  RailJourney,
  | "id"
  | "depStationName"
  | "arrStationName"
  | "depLat"
  | "depLon"
  | "arrLat"
  | "arrLon"
  | "geometry"
  | "geometrySource"
  | "status"
>;

export interface RailPathDatum {
  id: string;
  path: Array<[number, number]>;
  /** True when the line follows the train (Transitous); false for a chord. */
  traced: boolean;
  label: string;
}

export interface RailStationDatum {
  key: string;
  position: [number, number];
  name: string;
}

/**
 * Lifted on the globe only: an unlifted path lies IN the sphere's surface and
 * z-fights with it until it disappears. The same altitude cruise and tour
 * paths use there, kept as its own constant for the same reason theirs are.
 */
export const RAIL_PATH_GLOBE_ALTITUDE_M = 5_000;

/** A frozen line is used only when it is a line; anything shorter is the chord. */
export function railPathOf(journey: RailPathSource): Array<[number, number]> {
  if (journey.geometry && journey.geometry.length >= 2) return journey.geometry;
  return greatCirclePath([journey.depLon, journey.depLat], [journey.arrLon, journey.arrLat])
    .points as Array<[number, number]>;
}

export function isTracedRailLine(journey: RailPathSource): boolean {
  return (
    journey.geometrySource === "transitous" &&
    journey.geometry !== null &&
    journey.geometry.length >= 2
  );
}

/**
 * A cancelled train never ran, so it draws no line — the same reading every
 * rail statistic takes of it.
 */
export function buildRailPaths(journeys: readonly RailPathSource[]): RailPathDatum[] {
  return journeys
    .filter((j) => j.status !== "cancelled")
    .map((j) => ({
      id: j.id,
      path: railPathOf(j),
      traced: isTracedRailLine(j),
      label: `${j.depStationName} → ${j.arrStationName}`,
    }));
}

/** Each station once, however many journeys start or end there. */
export function buildRailStations(journeys: readonly RailPathSource[]): RailStationDatum[] {
  const byKey = new Map<string, RailStationDatum>();
  for (const j of journeys) {
    if (j.status === "cancelled") continue;
    for (const [name, lon, lat] of [
      [j.depStationName, j.depLon, j.depLat],
      [j.arrStationName, j.arrLon, j.arrLat],
    ] as const) {
      const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
      if (!byKey.has(key)) byKey.set(key, { key, position: [lon, lat], name });
    }
  }
  return [...byKey.values()];
}

export interface RailLayerOptions {
  /** The rail colour, resolved by the caller from the domain colour store. */
  color: Rgb;
  /** 0 on the flat map, `RAIL_PATH_GLOBE_ALTITUDE_M` on the globe. */
  altitudeM?: number;
  /** Layer id prefix, so two maps on one page never share a layer id. */
  idPrefix?: string;
  pickable?: boolean;
}

const lift = (altitudeM: number) => (point: [number, number]) =>
  altitudeM === 0 ? point : ([point[0], point[1], altitudeM] as [number, number, number]);

export function buildRailDeckLayers(
  paths: readonly RailPathDatum[],
  stations: readonly RailStationDatum[],
  { color, altitudeM = 0, idPrefix = "rail", pickable = true }: RailLayerOptions
): Layer[] {
  if (paths.length === 0) return [];
  const up = lift(altitudeM);
  return [
    new PathLayer<RailPathDatum>({
      id: `${idPrefix}-paths`,
      data: paths,
      getPath: (d) => d.path.map(up),
      getColor: (d) => [...color, d.traced ? 255 : 170] as [number, number, number, number],
      getWidth: (d) => (d.traced ? 3.5 : 2),
      widthUnits: "pixels",
      widthMinPixels: 2,
      pickable,
      autoHighlight: pickable,
      highlightColor: [255, 255, 255, 80],
      updateTriggers: { getColor: color, getPath: altitudeM },
    }),
    new ScatterplotLayer<RailStationDatum>({
      id: `${idPrefix}-stations`,
      data: stations,
      getPosition: (d) => up(d.position),
      getFillColor: [...color, 255] as [number, number, number, number],
      getLineColor: [15, 18, 24, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      stroked: true,
      radiusUnits: "pixels",
      getRadius: 4,
      pickable,
      updateTriggers: { getFillColor: color, getPosition: altitudeM },
    }),
  ];
}

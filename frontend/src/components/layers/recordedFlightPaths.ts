// A flight drawn along its recorded track instead of the great circle
// (forgejo#312).
//
// The rule, shared by the flat map (`routesLayer.ts`) and the globe
// (`Globe/globeArcData.ts`): a route is still ONE aggregated route — its
// count, colour tier and width are computed over all its flights exactly as
// before — but each recorded flight on it is drawn along its recording, in the
// route's colour. The great-circle arc stays as long as at least one flight on
// the route has no recording, because the arc is then still the only line
// that flight has; it goes once every flight on the route was recorded.

import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";

import type { ArcDatum } from "./layerTypes";
import type { GeoJSONFeature } from "../../types";
import type { FlightTrackLine } from "../../types/flightTrack";

export const RECORDED_ROUTES_LAYER_ID = "routes-recorded";

/** One recorded flight's stretches, each a `[lon, lat]` line of two or more points. */
export type RecordedPaths = Array<Array<[number, number]>>;

/**
 * The line cut at every recorded stretch's start: between two stretches the
 * receiver had no fix, and joining them would draw a flight path nobody
 * recorded. A one-point stretch is no line and is dropped.
 */
export function recordedPathsFromLine(line: FlightTrackLine): RecordedPaths {
  const starts = [...new Set([0, ...line.segmentStarts])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < line.geometry.length)
    .sort((a, b) => a - b);
  return starts
    .map((start, i) => line.geometry.slice(start, starts[i + 1] ?? line.geometry.length))
    .filter((path) => path.length >= 2);
}

/** The features with each recorded flight's paths attached; untouched features stay the same objects. */
export function withRecordedPaths(
  features: readonly GeoJSONFeature[],
  lines: readonly FlightTrackLine[]
): GeoJSONFeature[] {
  const byFlight = new Map<string, RecordedPaths>();
  for (const line of lines) {
    const paths = recordedPathsFromLine(line);
    if (paths.length > 0) byFlight.set(line.flightId, paths);
  }
  return features.map((f) => {
    const recordedPaths = byFlight.get(f.properties.id);
    return recordedPaths ? { ...f, properties: { ...f.properties, recordedPaths } } : f;
  });
}

/** What a route record keeps about its recorded flights while it aggregates. */
export interface RouteRecordings {
  recorded: Array<{ flightId: string; paths: RecordedPaths }>;
  /** Flights on the route WITHOUT a recording — while > 0 the arc stays. */
  unrecordedCount: number;
}

export function emptyRecordings(): RouteRecordings {
  return { recorded: [], unrecordedCount: 0 };
}

/** The record with this flight counted in — a new object, the old one untouched. */
export function addRecording(acc: RouteRecordings, feature: GeoJSONFeature): RouteRecordings {
  const paths = feature.properties.recordedPaths;
  return paths && paths.length > 0
    ? { ...acc, recorded: [...acc.recorded, { flightId: feature.properties.id, paths }] }
    : { ...acc, unrecordedCount: acc.unrecordedCount + 1 };
}

/** A recorded stretch on the flat map: the route's arc datum, narrowed to one flight, plus its line. */
export interface RecordedRouteDatum extends ArcDatum {
  path: Array<[number, number]>;
}

/** The route's arc datum spread over each of its recorded flights' stretches. */
export function recordedRouteData(
  routeArc: ArcDatum,
  recordings: RouteRecordings
): RecordedRouteDatum[] {
  return recordings.recorded.flatMap(({ flightId, paths }) =>
    paths.map((path) => ({
      ...routeArc,
      flightIds: [flightId],
      sourcePosition: path[0],
      targetPosition: path[path.length - 1],
      path,
    }))
  );
}

interface RecordedLayerOptions {
  widthPx: (count: number, isHistorical: boolean, selected: boolean) => number;
  widthScale: number;
  selectedIds: string[];
  highlightColor: [number, number, number, number];
  dimAlpha: number;
  onFlightClick?: (flightId: string | string[]) => void;
}

/**
 * The recorded stretches as a surface path — in BOTH route shapes, since a
 * recording is where the aircraft was and has no bow to raise. Colour, width,
 * selection and click follow the arcs' own rules (`routesLayer.ts`).
 */
export function createRecordedRoutesLayer(
  data: RecordedRouteDatum[],
  opts: RecordedLayerOptions
): Layer {
  const selected = new Set(opts.selectedIds);
  const isSelected = (d: RecordedRouteDatum) => d.flightIds.some((id) => selected.has(id));
  const hasSelection = selected.size > 0;
  return new PathLayer<RecordedRouteDatum>({
    id: RECORDED_ROUTES_LAYER_ID,
    data,
    getPath: (d) => d.path,
    getColor: (d) => {
      if (!hasSelection) return d.sourceColor;
      if (isSelected(d)) return opts.highlightColor;
      return [d.sourceColor[0], d.sourceColor[1], d.sourceColor[2], opts.dimAlpha];
    },
    getWidth: (d) => opts.widthPx(d.count, !!d.isHistorical, hasSelection && isSelected(d)),
    widthUnits: "pixels",
    widthMinPixels: 2 * opts.widthScale,
    capRounded: true,
    jointRounded: true,
    // A transpacific recording crosses the antimeridian; unwrapped, PathLayer
    // would draw that step as a line across the whole map.
    wrapLongitude: true,
    pickable: !!opts.onFlightClick,
    onClick: opts.onFlightClick
      ? ({ object }: { object?: RecordedRouteDatum }) => {
          if (object && object.flightIds.length > 0) opts.onFlightClick?.(object.flightIds);
        }
      : undefined,
    updateTriggers: { getColor: opts.selectedIds, getWidth: opts.selectedIds },
  });
}

// A flight's recorded track drawn on the dashboard map (forgejo#312).
//
// The dashboard shows ROUTES — one great-circle arc per airport pair, its
// count, colour tier and width aggregated over all its flights. A recording
// is ONE flight, so it is not part of that picture by default: it is drawn
// only when the user switches on „Aufgezeichnete Flugwege zeigen" in the map
// panel (`store/recordedFlightPathsStore.ts`), and then IN ADDITION to the
// arcs — thin, in its route's colour, never as wide as the route's frequency.
// The rule is shared by the flat map (`routesLayer.ts`) and the globe
// (`Globe/globeArcData.ts`). Measured stretches are solid, the connectors
// across the holes between them dashed and fainter (`flightTrackPieces`).

import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Layer } from "@deck.gl/core";

import type { ArcDatum } from "./layerTypes";
import type { GeoJSONFeature } from "../../types";
import type { FlightTrackLine } from "../../types/flightTrack";
import { flightTrackPieces, type FlightTrackPieces } from "../flightTrack/flightTrackPaths";

export const RECORDED_ROUTES_LAYER_ID = "routes-recorded";

/** Pixel width of a measured stretch and of a connector, before the user's width scale. */
export const RECORDED_SOLID_WIDTH_PX = 1.5;
export const RECORDED_GAP_WIDTH_PX = 1;
/** Dash pattern of a connector across a hole. */
export const RECORDED_GAP_DASH: [number, number] = [4, 3];
/** A connector's alpha as a share of the stretch's own. */
export const RECORDED_GAP_ALPHA_SHARE = 0.55;

/** One recorded flight's line, cut into measured stretches and hole connectors. */
export function recordedTrackFromLine(line: FlightTrackLine): FlightTrackPieces {
  return flightTrackPieces(line.geometry, line.segmentStarts);
}

/** The features with each recorded flight's track attached; untouched features stay the same objects. */
export function withRecordedPaths(
  features: readonly GeoJSONFeature[],
  lines: readonly FlightTrackLine[]
): GeoJSONFeature[] {
  const byFlight = new Map<string, FlightTrackPieces>();
  for (const line of lines) {
    const track = recordedTrackFromLine(line);
    if (track.solid.length + track.gaps.length > 0) byFlight.set(line.flightId, track);
  }
  return features.map((f) => {
    const recordedTrack = byFlight.get(f.properties.id);
    return recordedTrack ? { ...f, properties: { ...f.properties, recordedTrack } } : f;
  });
}

/** What a route record keeps about its recorded flights while it aggregates. */
export interface RouteRecordings {
  recorded: Array<{ flightId: string; track: FlightTrackPieces }>;
}

export function emptyRecordings(): RouteRecordings {
  return { recorded: [] };
}

/** The record with this flight counted in — a new object, the old one untouched. */
export function addRecording(acc: RouteRecordings, feature: GeoJSONFeature): RouteRecordings {
  const track = feature.properties.recordedTrack;
  return track ? { recorded: [...acc.recorded, { flightId: feature.properties.id, track }] } : acc;
}

/** Each drawn line of a route's recordings, flagged solid or connector. */
export function recordedLines(
  recordings: RouteRecordings
): Array<{ flightId: string; path: Array<[number, number]>; gap: boolean }> {
  return recordings.recorded.flatMap(({ flightId, track }) => [
    ...track.solid.map((path) => ({ flightId, path, gap: false })),
    ...track.gaps.map((path) => ({ flightId, path, gap: true })),
  ]);
}

/** A recorded line on the flat map: the route's arc datum, narrowed to one flight, plus its line. */
export interface RecordedRouteDatum extends ArcDatum {
  path: Array<[number, number]>;
  /** A connector across a hole in the recording, not a measured stretch. */
  gap: boolean;
}

/** The route's arc datum spread over each of its recorded flights' lines. */
export function recordedRouteData(
  routeArc: ArcDatum,
  recordings: RouteRecordings
): RecordedRouteDatum[] {
  return recordedLines(recordings).map(({ flightId, path, gap }) => ({
    ...routeArc,
    flightIds: [flightId],
    sourcePosition: path[0],
    targetPosition: path[path.length - 1],
    path,
    gap,
  }));
}

interface RecordedLayerOptions {
  widthScale: number;
  selectedIds: string[];
  highlightColor: [number, number, number, number];
  dimAlpha: number;
  onFlightClick?: (flightId: string | string[]) => void;
}

/**
 * The recorded lines as a surface path — in BOTH route shapes, since a
 * recording is where the aircraft was and has no bow to raise. Colour,
 * selection and click follow the arcs' own rules (`routesLayer.ts`); the width
 * does NOT, because the arc's width is the route's frequency and a recording
 * is one flight.
 */
export function createRecordedRoutesLayer(
  data: RecordedRouteDatum[],
  opts: RecordedLayerOptions
): Layer {
  const selected = new Set(opts.selectedIds);
  const isSelected = (d: RecordedRouteDatum) => d.flightIds.some((id) => selected.has(id));
  const hasSelection = selected.size > 0;
  const highlight = (d: RecordedRouteDatum) => hasSelection && isSelected(d);
  return new PathLayer<RecordedRouteDatum, PathStyleExtensionProps<RecordedRouteDatum>>({
    id: RECORDED_ROUTES_LAYER_ID,
    data,
    getPath: (d) => d.path,
    getColor: (d) => {
      const [r, g, b, a = 255] = !hasSelection
        ? d.sourceColor
        : isSelected(d)
          ? opts.highlightColor
          : [d.sourceColor[0], d.sourceColor[1], d.sourceColor[2], opts.dimAlpha];
      return [r, g, b, d.gap ? Math.round(a * RECORDED_GAP_ALPHA_SHARE) : a];
    },
    getWidth: (d) =>
      (d.gap ? RECORDED_GAP_WIDTH_PX : RECORDED_SOLID_WIDTH_PX) * (highlight(d) ? 1.5 : 1),
    widthUnits: "pixels",
    widthScale: opts.widthScale,
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    getDashArray: (d) => (d.gap ? RECORDED_GAP_DASH : [0, 0]),
    dashJustified: true,
    dashGapPickable: true,
    extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
    // Longitudes arrive unwrapped (`flightTrackPieces`), as the great-circle
    // routes beside them do: deck.gl draws them into the adjacent world copy
    // instead of a step back across the whole map.
    wrapLongitude: false,
    pickable: !!opts.onFlightClick,
    onClick: opts.onFlightClick
      ? ({ object }: { object?: RecordedRouteDatum }) => {
          if (object && object.flightIds.length > 0) opts.onFlightClick?.(object.flightIds);
        }
      : undefined,
    updateTriggers: { getColor: opts.selectedIds, getWidth: opts.selectedIds },
  });
}

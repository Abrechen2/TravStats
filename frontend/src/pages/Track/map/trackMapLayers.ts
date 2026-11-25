import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Feature, Geometry } from "geojson";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { token } from "../../../components/ui/tokens";
import { tokenRgb, type Rgb } from "./trackTokenRgb";
import type { TrackPoint, TravTrackDayEntry } from "../../../lib/api/travtrack";
import type { TravTrackPointDetail } from "../../../lib/api/travtrackLegs";
import type { TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { contextLabel } from "../trackContextLabel";
import type { SpeedStop } from "./trackSpeedScale";
import { lonLat, speedColor, speedPieces, type LonLat, type SpeedPiece } from "./trackGeometry";
import type { RouteColorMode, TrackLayer } from "./trackMapPrefs";
import type { ModeColorKey } from "../../../lib/trackModeColor";

/**
 * The deck.gl layers of the Track map (TravTrack plan T5.2), built from the
 * safe stretches and the days' labels. There is deliberately no layer for
 * privacy zones: a zone is never drawn on the ordinary map — it would point
 * at exactly what it hides (plan, phase 5). Zones live in Settings only.
 */

/**
 * TravTrack's area colour (concept board, variant B) — the theme's `live`
 * token. `TRACK_COLOR` is for CSS; WebGL and MapLibre paint need the channels.
 */
export const TRACK_RGB: [number, number, number] = [94, 194, 178];
export const TRACK_COLOR = token("live");
export const TRACK_RGB_CSS = `rgb(${TRACK_RGB.join(", ")})`;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AnchorGroup = "visits" | "entries";

export interface MapAnchor {
  lat: number;
  lon: number;
  kind: string;
  text: string;
  group: AnchorGroup;
  /** A question or a bare stretch: drawn hollow, not as a record. */
  open: boolean;
}

const VISIT_KINDS = new Set(["home", "lodging", "poi"]);

/** Stays and places on one switch, the logbook's journeys on the other. */
export function anchorGroup(entry: TravTrackDayEntry): AnchorGroup {
  if (VISIT_KINDS.has(entry.kind)) return "visits";
  if (entry.kind === "suggestion" && entry.suggestion !== "journey") return "visits";
  return "entries";
}

/** The labels the map can place: only those the server gave an anchor. */
export function mapAnchors(context: readonly TravTrackDayEntry[], t: Translate): MapAnchor[] {
  return context.flatMap((entry) =>
    entry.anchor
      ? [
          {
            lat: entry.anchor.lat,
            lon: entry.anchor.lon,
            kind: entry.kind,
            text: contextLabel(entry, t),
            group: anchorGroup(entry),
            open: entry.kind === "suggestion" || entry.kind === "movement",
          },
        ]
      : []
  );
}

/** A fix as the points layer and the inspector know it. */
export interface MapPoint {
  point: TrackPoint;
  /** The phone's speed, altitude and motion at this vertex; absent on an older server. */
  detail?: TravTrackPointDetail | null;
  zone: string;
  /** The stored point behind the vertex (for „Punkt löschen"); null from an older server. */
  id: string | null;
}

/** One leg's stretch for picking: a click on its line selects the leg. */
export interface MapLegLine {
  id: string;
  date: string;
  path: LonLat[];
}

/** One drawn stretch of a long span, for picking: a click names the instant of the nearest vertex. */
export interface MapRangeLine {
  path: LonLat[];
  /** The fix instant of each vertex of `path`. */
  times: number[];
}

/** The instant of the vertex of `line` nearest to a clicked coordinate; null for an empty line. */
export function nearestTime(line: MapRangeLine, at: readonly number[]): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  line.path.forEach(([lon, lat], i) => {
    const d = (lon - at[0]) ** 2 + (lat - at[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = line.times[i] ?? null;
    }
  });
  return best;
}

/** The leg line's hit width in px: a fingertip on a coarse pointer, a pencil line otherwise. */
export const LEG_PICK_WIDTH = 16;
export const LEG_PICK_WIDTH_COARSE = 40;

/** One leg's drawn stretch with its mode, for colouring by transport mode. */
export interface MapModePath {
  path: LonLat[];
  mode: ModeColorKey;
}

/** A dwell between legs, drawn as a marker that opens its card. */
export interface MapStop {
  date: string;
  fromMs: number;
  lat: number;
  lon: number;
  selected: boolean;
  /** The stay's status when the server tied one to the stop. */
  stay: string | null;
}

export interface TrackLayerInput {
  layers: Record<TrackLayer, boolean>;
  color: RouteColorMode;
  opacity: number;
  /** The stretches after the client split; the replay's trail when it runs. */
  lines: readonly LonLat[][];
  segments: readonly TrackPoint[][];
  points: readonly MapPoint[];
  anchors: readonly MapAnchor[];
  /** Where the replay stands; empty while it is not running. */
  replay: readonly LonLat[];
  onPoint: (point: MapPoint) => void;
  /** Photos at the positions the server placed them; empty while the layer is off. */
  photos: readonly TravTrackPhoto[];
  onPhoto: (photo: TravTrackPhoto) => void;
  /** The visited countries' shapes (the countries layer); empty while it is off. */
  countries: readonly Feature<Geometry>[];
  /** The open flight panel's whole flight, drawn over the span's line; empty without one. */
  highlight?: readonly LonLat[][];
  /** The picked leg's stretches: drawn wide over the line, the rest fades. */
  selection?: readonly LonLat[][];
  /** The picked leg's stretches with readings: drawn in the route's own colours over a halo. */
  selectionSegments?: readonly TrackPoint[][];
  /** Every leg's stretches, pickable (clear but present); omitted, no line is clickable. */
  legLines?: readonly MapLegLine[];
  onLeg?: (leg: MapLegLine) => void;
  /** Colour by transport mode: the legs' stretches and the colour of each mode. */
  modePaths?: readonly MapModePath[];
  modeColors?: Record<ModeColorKey, Rgb>;
  /** The leg lines' and the range lines' hit width in px; omitted, `LEG_PICK_WIDTH`. */
  pickWidth?: number;
  /**
   * A long span's drawn stretches, pickable: its legs are not shipped with the range read, so a
   * click names an instant and the view reads that day to find the leg.
   */
  rangeLines?: readonly MapRangeLine[];
  onRangePick?: (atMs: number) => void;
  stops?: readonly MapStop[];
  onStop?: (stop: MapStop) => void;
  /** The speed ramp's stops; omitted, the default ramp. */
  speedStops?: readonly SpeedStop[];
  /** The picked leg's vertices, drawn whatever the points layer says; empty draws nothing. */
  legPoints?: readonly MapPoint[];
  /** Long silences, drawn dashed and faint: estimated, never counted (best source per day). */
  estimated?: readonly LonLat[][];
  /** Jumps a logged entry explains, drawn with the entry's own line. */
  bridges?: readonly LonLat[][];
}

/** The dash of an estimated stretch, in pixels: dash, gap. */
const ESTIMATED_DASH: [number, number] = [6, 6];

/** The open flight's line: bright, over the span's line, never joined across its own breaks. */
const HIGHLIGHT_RGB: [number, number, number] = [244, 236, 224];

/** The photo markers' colour: the Stats accent, apart from the track's own. */
const PHOTO_RGB: [number, number, number] = [240, 169, 71];

/** A label's words on hover; nothing for lines, points and the heat. */
export const tooltipOf = (info: PickingInfo): string | null => {
  const object = info.object as Partial<MapAnchor> | undefined;
  return typeof object?.text === "string" ? object.text : null;
};

/**
 * Derived layer data, computed once per input array. The replay rebuilds the
 * layer list ten times a second; a derived array built afresh each time hands
 * deck.gl new `data`, which re-aggregates the heat, re-uploads the scatter and
 * re-tessellates the countries (forgejo#351). Keyed weakly on the input array.
 */
function byRef<K extends object, V>(derive: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = derive(key);
      cache.set(key, hit);
    }
    return hit;
  };
}

const speedPiecesOf = byRef((segments: readonly TrackPoint[][]) => speedPieces(segments));
const countriesDataOf = byRef((countries: readonly Feature<Geometry>[]) => ({
  type: "FeatureCollection" as const,
  features: countries as Feature<Geometry>[],
}));
const visitAnchorsOf = byRef((anchors: readonly MapAnchor[]) =>
  anchors.filter((a) => a.group === "visits")
);
const entryAnchorsOf = byRef((anchors: readonly MapAnchor[]) =>
  anchors.filter((a) => a.group === "entries")
);

function routeLayer(input: TrackLayerInput, alpha: number): Layer {
  if (input.color === "mode" && input.modeColors && input.modePaths && input.modePaths.length > 0) {
    const table = input.modeColors;
    return new PathLayer<MapModePath>({
      id: "track-route-mode",
      data: input.modePaths as MapModePath[],
      getPath: (d) => d.path,
      getColor: (d) => [...table[d.mode], alpha],
      updateTriggers: { getColor: [alpha, table] },
      getWidth: 4,
      widthUnits: "pixels",
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
      pickable: false,
    });
  }
  if (input.color === "speed") {
    return new PathLayer<SpeedPiece>({
      id: "track-route-speed",
      data: speedPiecesOf(input.segments),
      getPath: (d) => d.path,
      getColor: (d) => [...speedColor(d.kmh, input.speedStops), alpha],
      // The accessor reads `alpha` and the ramp, and the data is stable across ticks.
      updateTriggers: { getColor: [alpha, input.speedStops] },
      getWidth: 4,
      widthUnits: "pixels",
      widthMinPixels: 2,
      capRounded: true,
      pickable: false,
    });
  }
  return new PathLayer<LonLat[]>({
    id: "track-route-plain",
    data: input.lines as LonLat[][],
    getPath: (d) => d,
    getColor: [...TRACK_RGB, alpha],
    getWidth: 4,
    widthUnits: "pixels",
    widthMinPixels: 2,
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}

function anchorLayer(id: string, anchors: readonly MapAnchor[]): Layer {
  return new ScatterplotLayer<MapAnchor>({
    id,
    data: anchors as MapAnchor[],
    getPosition: (a) => [a.lon, a.lat],
    getRadius: 7,
    radiusUnits: "pixels",
    stroked: true,
    filled: true,
    getFillColor: (a) => (a.open ? [255, 255, 255, 230] : [...TRACK_RGB, 255]),
    getLineColor: [11, 13, 16, 255],
    lineWidthUnits: "pixels",
    getLineWidth: 2,
    pickable: true,
  });
}

/** A stop's outline: its stay's status colour, the track's own where it has no stay. */
export function stopOutlineOf(c: { warn: Rgb; good: Rgb; muted: Rgb }) {
  return (stay: string | null): Rgb =>
    stay === null
      ? TRACK_RGB
      : stay === "pending"
        ? c.warn
        : stay === "accepted"
          ? c.good
          : c.muted;
}

export function buildTrackLayers(input: TrackLayerInput): Layer[] {
  const on = input.layers;
  const dim = on.routes && (input.selection?.length ?? 0) > 0;
  // The picked leg stands out by the others stepping back, not by hiding them.
  const alpha = Math.round(input.opacity * 255 * (dim ? 0.3 : 1));
  const out: Layer[] = [];
  // Under everything else: a country is the ground the line runs on.
  if (on.countries && input.countries.length > 0) {
    out.push(
      new GeoJsonLayer({
        id: "track-countries",
        data: countriesDataOf(input.countries),
        filled: true,
        stroked: true,
        getFillColor: [...TRACK_RGB, 60],
        getLineColor: [...TRACK_RGB, 180],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        pickable: false,
      })
    );
  }
  if (on.heat) {
    out.push(
      new HeatmapLayer<MapPoint>({
        id: "track-heat",
        data: input.points as MapPoint[],
        getPosition: (d) => lonLat(d.point),
        getWeight: 1,
        radiusPixels: 40,
        intensity: 1,
        threshold: 0.03,
      })
    );
  }
  if (on.routes) out.push(routeLayer(input, alpha));
  if (on.routes && (input.bridges?.length ?? 0) > 0) {
    out.push(
      new PathLayer<LonLat[]>({
        id: "track-bridges",
        data: input.bridges as LonLat[][],
        getPath: (d) => d,
        getColor: [...TRACK_RGB, Math.round(alpha * 0.7)],
        getWidth: 2,
        widthUnits: "pixels",
        wrapLongitude: false,
        pickable: false,
      })
    );
  }
  if (on.routes && (input.estimated?.length ?? 0) > 0) {
    out.push(
      new PathLayer<LonLat[], PathStyleExtensionProps<LonLat[]>>({
        id: "track-estimated",
        data: input.estimated as LonLat[][],
        getPath: (d) => d,
        getColor: [...TRACK_RGB, Math.round(alpha * 0.55)],
        getWidth: 2,
        widthUnits: "pixels",
        getDashArray: ESTIMATED_DASH,
        dashJustified: true,
        extensions: [new PathStyleExtension({ dash: true })],
        pickable: false,
      })
    );
  }
  if (input.highlight && input.highlight.length > 0) {
    out.push(
      new PathLayer<LonLat[]>({
        id: "track-flight",
        data: input.highlight as LonLat[][],
        getPath: (d) => d,
        getColor: [...HIGHLIGHT_RGB, 255],
        getWidth: 4,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
      })
    );
  }
  if (dim) {
    // A halo under the leg, then the leg in the route's own colours at full strength.
    out.push(
      new PathLayer<LonLat[]>({
        id: "track-leg-selected",
        data: input.selection as LonLat[][],
        getPath: (d) => d,
        getColor: [...HIGHLIGHT_RGB, 170],
        getWidth: 10,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
      })
    );
    const segments = input.selectionSegments ?? [];
    if (input.color === "speed" && segments.length > 0) {
      out.push(
        new PathLayer<SpeedPiece>({
          id: "track-leg-selected-speed",
          data: speedPieces(segments),
          getPath: (d) => d.path,
          getColor: (d) => [...speedColor(d.kmh, input.speedStops), 255],
          updateTriggers: { getColor: [input.speedStops] },
          getWidth: 6,
          widthUnits: "pixels",
          capRounded: true,
          pickable: false,
        })
      );
    } else {
      out.push(
        new PathLayer<LonLat[]>({
          id: "track-leg-selected-plain",
          data: input.selection as LonLat[][],
          getPath: (d) => d,
          getColor: [...TRACK_RGB, 255],
          getWidth: 6,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        })
      );
    }
  }
  if (on.routes && input.legLines && input.legLines.length > 0 && input.onLeg) {
    const onLeg = input.onLeg;
    out.push(
      new PathLayer<MapLegLine>({
        id: "track-leg-pick",
        data: input.legLines as MapLegLine[],
        getPath: (d) => d.path,
        // Alpha 1, not 0: a fully clear stroke is not offered to picking.
        getColor: [0, 0, 0, 1],
        getWidth: input.pickWidth ?? LEG_PICK_WIDTH,
        widthUnits: "pixels",
        pickable: true,
        onClick: (info: PickingInfo<MapLegLine>) => {
          if (info.object) onLeg(info.object);
          return true;
        },
      })
    );
  }
  if (on.routes && input.rangeLines && input.rangeLines.length > 0 && input.onRangePick) {
    const onRangePick = input.onRangePick;
    out.push(
      new PathLayer<MapRangeLine>({
        id: "track-range-pick",
        data: input.rangeLines as MapRangeLine[],
        getPath: (d) => d.path,
        getColor: [0, 0, 0, 1],
        getWidth: input.pickWidth ?? LEG_PICK_WIDTH,
        widthUnits: "pixels",
        pickable: true,
        onClick: (info: PickingInfo<MapRangeLine>) => {
          if (!info.object || !info.coordinate) return false;
          const at = nearestTime(info.object, info.coordinate);
          if (at !== null) onRangePick(at);
          return true;
        },
      })
    );
  }
  if (on.points) {
    out.push(
      new ScatterplotLayer<MapPoint>({
        id: "track-points",
        data: input.points as MapPoint[],
        getPosition: (d) => lonLat(d.point),
        getRadius: 4,
        radiusUnits: "pixels",
        radiusMinPixels: 3,
        stroked: true,
        getFillColor: [231, 227, 220, 255],
        getLineColor: [11, 13, 16, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        pickable: true,
        onClick: (info: PickingInfo<MapPoint>) => {
          if (info.object) input.onPoint(info.object);
          return true;
        },
      })
    );
  }
  if (input.legPoints && input.legPoints.length > 0) {
    out.push(
      new ScatterplotLayer<MapPoint>({
        id: "track-leg-points",
        data: input.legPoints as MapPoint[],
        getPosition: (d) => lonLat(d.point),
        getRadius: 5,
        radiusUnits: "pixels",
        radiusMinPixels: 4,
        stroked: true,
        getFillColor: [...HIGHLIGHT_RGB, 255],
        getLineColor: [...TRACK_RGB, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        pickable: true,
        onClick: (info: PickingInfo<MapPoint>) => {
          if (info.object) input.onPoint(info.object);
          return true;
        },
      })
    );
  }
  if (on.visits) {
    out.push(anchorLayer("track-visits", visitAnchorsOf(input.anchors)));
  }
  if (on.visits && input.stops && input.stops.length > 0) {
    const onStop = input.onStop;
    // The same status colours the stays list draws: pending warn, accepted good, other muted.
    const surface = tokenRgb("surface");
    const stopOutline = stopOutlineOf({
      warn: tokenRgb("warn"),
      good: tokenRgb("good"),
      muted: tokenRgb("muted"),
    });
    out.push(
      new ScatterplotLayer<MapStop>({
        id: "track-stops",
        data: input.stops as MapStop[],
        getPosition: (s) => [s.lon, s.lat],
        getRadius: 9,
        radiusUnits: "pixels",
        stroked: true,
        filled: true,
        getFillColor: (s) => (s.selected ? [...HIGHLIGHT_RGB, 255] : [...surface, 255]),
        getLineColor: (s) => [...stopOutline(s.stay), 255],
        lineWidthUnits: "pixels",
        getLineWidth: 3,
        updateTriggers: { getFillColor: [input.stops], getLineColor: [input.stops] },
        pickable: true,
        onClick: (info: PickingInfo<MapStop>) => {
          if (info.object && onStop) onStop(info.object);
          return true;
        },
      })
    );
  }
  if (on.entries) {
    out.push(anchorLayer("track-entries", entryAnchorsOf(input.anchors)));
  }
  if (on.photos && input.photos.length > 0) {
    out.push(
      new ScatterplotLayer<TravTrackPhoto>({
        id: "track-photos",
        data: input.photos as TravTrackPhoto[],
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 7,
        radiusUnits: "pixels",
        stroked: true,
        getFillColor: [...PHOTO_RGB, 255],
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        pickable: true,
        onClick: (info: PickingInfo<TravTrackPhoto>) => {
          if (info.object) input.onPhoto(info.object);
          return true;
        },
      })
    );
  }
  if (input.replay.length > 0) {
    out.push(
      new ScatterplotLayer<LonLat>({
        id: "track-replay-head",
        data: [...input.replay],
        getPosition: (d) => d,
        getRadius: 8,
        radiusUnits: "pixels",
        stroked: true,
        getFillColor: [...TRACK_RGB, 255],
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        pickable: false,
      })
    );
  }
  return out;
}

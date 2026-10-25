import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Feature, Geometry } from "geojson";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { token } from "../../../components/ui/tokens";
import type { TrackPoint, TravTrackDayEntry } from "../../../lib/api/travtrack";
import type { TravTrackPhoto } from "../../../lib/api/travtrackViews";
import { contextLabel } from "../trackContextLabel";
import { lonLat, speedColor, speedPieces, type LonLat, type SpeedPiece } from "./trackGeometry";
import type { RouteColorMode, TrackLayer } from "./trackMapPrefs";

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
  zone: string;
  /** The stored point behind the vertex (for „Punkt löschen"); null from an older server. */
  id: string | null;
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
}

/** The photo markers' colour: the Stats accent, apart from the track's own. */
const PHOTO_RGB: [number, number, number] = [240, 169, 71];

/** A label's words on hover; nothing for lines, points and the heat. */
export const tooltipOf = (info: PickingInfo): string | null => {
  const object = info.object as Partial<MapAnchor> | undefined;
  return typeof object?.text === "string" ? object.text : null;
};

function routeLayer(input: TrackLayerInput, alpha: number): Layer {
  if (input.color === "speed") {
    return new PathLayer<SpeedPiece>({
      id: "track-route-speed",
      data: speedPieces(input.segments),
      getPath: (d) => d.path,
      getColor: (d) => [...speedColor(d.kmh), alpha],
      getWidth: 4,
      widthUnits: "pixels",
      widthMinPixels: 2,
      capRounded: true,
      pickable: false,
    });
  }
  return new PathLayer<LonLat[]>({
    id: "track-route-plain",
    data: [...input.lines],
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
    data: [...anchors],
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

export function buildTrackLayers(input: TrackLayerInput): Layer[] {
  const alpha = Math.round(input.opacity * 255);
  const on = input.layers;
  const out: Layer[] = [];
  // Under everything else: a country is the ground the line runs on.
  if (on.countries && input.countries.length > 0) {
    out.push(
      new GeoJsonLayer({
        id: "track-countries",
        data: { type: "FeatureCollection", features: [...input.countries] },
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
        data: [...input.points],
        getPosition: (d) => lonLat(d.point),
        getWeight: 1,
        radiusPixels: 40,
        intensity: 1,
        threshold: 0.03,
      })
    );
  }
  if (on.routes) out.push(routeLayer(input, alpha));
  if (on.points) {
    out.push(
      new ScatterplotLayer<MapPoint>({
        id: "track-points",
        data: [...input.points],
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
  if (on.visits) {
    out.push(
      anchorLayer(
        "track-visits",
        input.anchors.filter((a) => a.group === "visits")
      )
    );
  }
  if (on.entries) {
    out.push(
      anchorLayer(
        "track-entries",
        input.anchors.filter((a) => a.group === "entries")
      )
    );
  }
  if (on.photos && input.photos.length > 0) {
    out.push(
      new ScatterplotLayer<TravTrackPhoto>({
        id: "track-photos",
        data: [...input.photos],
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

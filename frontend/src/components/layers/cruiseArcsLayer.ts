import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { effectivePortSequence } from "../Cruise/cruisePorts";
import { catmullRomSpline } from "./catmullRom";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
}

interface ArrowDatum {
  position: [number, number];
  angleDeg: number;
  cruiseId: string;
}

interface CruiseArcBuildOptions {
  /**
   * Rounded map zoom. At close range the layer renders backend
   * coordinates directly so fixed harbour and river approaches become
   * more exact as the user zooms in.
   */
  zoom?: number;
  /**
   * Base cruise-route colour (RGB), from the map control panel's
   * Kreuzfahrten appearance section. Falls back to the brand cruise
   * blue. `buildCruiseArcs` ignores it — it only shapes the layer.
   */
  arcColor?: [number, number, number];
  /** User multiplier on cruise-arc line width (1 = default). */
  arcWidthScale?: number;
}

// Brand cruise blue (BRAND.md §3, --domain-cruise). Shared default with
// the globe cruise paths + port markers so ship routes read the same
// everywhere. The selected-cruise highlight stays amber.
const CRUISE_BASE_COLOR: [number, number, number] = [111, 160, 214];
const CRUISE_HIGHLIGHT_COLOR: [number, number, number] = [253, 224, 71];

interface LegGeometry {
  coordinates: [number, number][];
  protectedPrefixCount: number;
  protectedSuffixCount: number;
}

const EXACT_ROUTE_ZOOM = 8;

/**
 * Per-cruise sea-route waypoints from `GET /api/v1/cruises/:id/geometry`.
 * Map provides one FeatureCollection per visible cruise; missing
 * entries (still fetching, fetch failed) fall through to the
 * waypoint-less chord fallback in `createCruiseArcsLayer`.
 */
export type CruiseGeometryMap = ReadonlyMap<string, CruiseRouteFeatureCollection>;

/**
 * Build a PathLayer of cruise legs rendered as smooth Catmull-Rom
 * splines through the backend's coarse waypoints. One path per
 * consecutive pair in the effective port sequence (departure port →
 * port-call stops → arrival port). At-sea days and stops without a
 * resolved port are skipped.
 *
 * When the backend hasn't returned geometry for a cruise yet, legs
 * fall back to a 2-vertex direct chord which the spline renders as
 * a straight line — nothing in the map ever looks disconnected.
 *
 * Returns `null` when no leg can be drawn so callers can omit the
 * layer entirely rather than mounting a no-op.
 */
/**
 * Compute the per-leg spline paths used by both the arc PathLayer and
 * the directional arrow TextLayer. Exported so the arrow layer can
 * share the exact same paths without recomputing the spline.
 */
export function buildCruiseArcs(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  options: CruiseArcBuildOptions = {}
): ArcDatum[] {
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    // Effective sequence includes departure/arrival ports so minimal
    // A-to-B cruises (no detailed stop list) still draw a route.
    const ports = effectivePortSequence(cruise);

    const geometry = geometryByCruise.get(cruise.id);
    const waypointsByPair = buildWaypointIndex(geometry);

    for (let i = 0; i < ports.length - 1; i++) {
      const a = ports[i];
      const b = ports[i + 1];
      const routeGeometry = waypointsByPair.get(pairKey(a.id, b.id)) ?? {
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ] as [number, number][],
        protectedPrefixCount: 0,
        protectedSuffixCount: 0,
      };
      arcs.push({
        path: buildRenderableRoutePath(routeGeometry, options),
        cruiseId: cruise.id,
        cruiseLine: cruise.cruiseLine,
      });
    }
  }
  return arcs;
}

export function createCruiseArcsLayer(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  /**
   * Currently selected cruise id. Non-selected arcs render at reduced
   * alpha; selected arcs gain a thicker, fully-opaque stroke.
   */
  selectedCruiseId: string | null = null,
  /** Click handler — receives the cruise id. */
  onCruiseClick?: (cruiseId: string) => void,
  options: CruiseArcBuildOptions = {}
): Layer | null {
  const arcs = buildCruiseArcs(cruises, geometryByCruise, options);
  if (arcs.length === 0) return null;

  const hasSelection = selectedCruiseId !== null;
  const BASE_COLOR = options.arcColor ?? CRUISE_BASE_COLOR;
  const HIGHLIGHT_COLOR = CRUISE_HIGHLIGHT_COLOR;
  const widthScale = options.arcWidthScale ?? 1;
  const DIM_ALPHA = 90;
  const FULL_ALPHA = 220;

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: (d) => {
      if (!hasSelection) return [...BASE_COLOR, FULL_ALPHA];
      if (d.cruiseId === selectedCruiseId) return [...HIGHLIGHT_COLOR, FULL_ALPHA];
      return [...BASE_COLOR, DIM_ALPHA];
    },
    getWidth: (d) => (d.cruiseId === selectedCruiseId ? 3 * widthScale : 2 * widthScale),
    widthUnits: "pixels",
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    pickable: true,
    onClick: onCruiseClick
      ? ({ object }: { object?: ArcDatum }) => {
          if (object?.cruiseId) onCruiseClick(object.cruiseId);
        }
      : undefined,
    updateTriggers: {
      getColor: [selectedCruiseId, BASE_COLOR],
      getWidth: [selectedCruiseId, widthScale],
    },
  });
}

/**
 * Build a directional arrow TextLayer per cruise leg. Arrows are
 * placed near (but not on top of) the destination port and rotated
 * to align with the local segment direction so the user can read
 * the cruise's flow at a glance.
 *
 * Returns `null` when no arrows can be drawn (no qualifying legs)
 * so callers can omit the layer rather than mounting a no-op.
 */
export function createCruiseArrowsLayer(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  selectedCruiseId: string | null = null,
  options: CruiseArcBuildOptions = {}
): Layer | null {
  const arcs = buildCruiseArcs(cruises, geometryByCruise, options);
  const arrows: ArrowDatum[] = [];
  for (const arc of arcs) {
    const anchor = pickArrowAnchor(arc.path);
    if (anchor === null) continue;
    arrows.push({ ...anchor, cruiseId: arc.cruiseId });
  }
  if (arrows.length === 0) return null;

  const hasSelection = selectedCruiseId !== null;
  const BASE_COLOR = options.arcColor ?? CRUISE_BASE_COLOR;
  const HIGHLIGHT_COLOR = CRUISE_HIGHLIGHT_COLOR;
  const DIM_ALPHA = 90;
  const FULL_ALPHA = 230;

  return new TextLayer<ArrowDatum>({
    id: "cruise-arc-arrows",
    data: arrows,
    // The default deck.gl font atlas only covers ASCII; the arrow
    // glyph (U+25B6) must be opted in via characterSet, otherwise
    // every label silently fails to render with "Missing character"
    // warnings.
    characterSet: ["▶"],
    getPosition: (d) => d.position,
    getText: () => "▶",
    getAngle: (d) => d.angleDeg,
    getColor: (d) => {
      if (!hasSelection) return [...BASE_COLOR, FULL_ALPHA];
      if (d.cruiseId === selectedCruiseId) return [...HIGHLIGHT_COLOR, FULL_ALPHA];
      return [...BASE_COLOR, DIM_ALPHA];
    },
    getSize: 16,
    sizeUnits: "pixels",
    fontFamily: "sans-serif",
    fontWeight: "bold",
    background: false,
    pickable: false,
    updateTriggers: {
      getColor: [selectedCruiseId, BASE_COLOR],
    },
  });
}

/**
 * Pick a position + screen-space angle for the directional arrow on
 * a splined leg path. The anchor sits at ~88 % along the spline so
 * the arrow visibly leads into the destination port without overlapping
 * the port marker. Returns `null` when the path is degenerate (less
 * than two distinct points) — the caller skips that leg's arrow.
 */
function pickArrowAnchor(
  path: ReadonlyArray<[number, number]>
): { position: [number, number]; angleDeg: number } | null {
  if (path.length < 2) return null;
  const headIdx = Math.max(1, Math.floor(path.length * 0.88));
  const tailIdx = Math.max(0, headIdx - 1);
  if (headIdx === tailIdx) return null;
  const [x0, y0] = path[tailIdx];
  const [x1, y1] = path[headIdx];
  const dx = x1 - x0;
  // TextLayer rotates clockwise in screen space; geographic latitude
  // increases northward (screen y is inverted), so we negate dy to
  // get a screen-space heading that matches the visible segment.
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return null;
  const angleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return { position: [x1, y1], angleDeg };
}

function pairKey(fromPortId: number, toPortId: number): string {
  return `${fromPortId}→${toPortId}`;
}

function buildWaypointIndex(
  geometry: CruiseRouteFeatureCollection | undefined
): Map<string, LegGeometry> {
  const index = new Map<string, LegGeometry>();
  if (!geometry) return index;
  for (const feature of geometry.features) {
    const { fromPortId, toPortId } = feature.properties;
    index.set(pairKey(fromPortId, toPortId), {
      coordinates: feature.geometry.coordinates,
      protectedPrefixCount: feature.properties.protectedPrefixCount ?? 0,
      protectedSuffixCount: feature.properties.protectedSuffixCount ?? 0,
    });
  }
  return index;
}

function buildRenderableRoutePath(
  geometry: LegGeometry,
  options: CruiseArcBuildOptions
): [number, number][] {
  const { coordinates } = geometry;
  if (coordinates.length <= 2) return coordinates.slice();
  if (typeof options.zoom === "number" && options.zoom >= EXACT_ROUTE_ZOOM) {
    return coordinates.slice();
  }

  const prefixCount = clampProtectedCount(geometry.protectedPrefixCount, coordinates.length);
  const suffixCount = clampProtectedCount(
    geometry.protectedSuffixCount,
    coordinates.length - prefixCount
  );
  if (prefixCount + suffixCount >= coordinates.length) return coordinates.slice();
  if (prefixCount === 0 && suffixCount === 0) return catmullRomSpline(coordinates);

  const splineStart = prefixCount > 0 ? prefixCount - 1 : 0;
  const splineEndExclusive =
    suffixCount > 0 ? coordinates.length - suffixCount + 1 : coordinates.length;
  const splineInput = coordinates.slice(splineStart, splineEndExclusive);
  const smoothedMiddle = catmullRomSpline(splineInput);
  const out: [number, number][] = [];

  for (let i = 0; i < prefixCount; i++) appendPathPoint(out, coordinates[i]);
  for (const point of smoothedMiddle) appendPathPoint(out, point);
  for (let i = coordinates.length - suffixCount; i < coordinates.length; i++) {
    appendPathPoint(out, coordinates[i]);
  }
  return out;
}

function clampProtectedCount(count: number, max: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(max, Math.floor(count)));
}

function appendPathPoint(out: [number, number][], point: [number, number]): void {
  const prev = out[out.length - 1];
  if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) out.push(point);
}

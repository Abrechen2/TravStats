import { IconLayer, PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Cruise } from "../../types";
import type { CruiseStatus } from "../../types/cruise";
import type { CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { effectivePortSequence } from "../Cruise/cruisePorts";
import { catmullRomSpline } from "./catmullRom";
import {
  DEFAULT_CRUISE_COLOR_CONFIG,
  resolveCruiseArcColor,
  type CruiseColorConfig,
  type Rgb,
} from "../../lib/cruiseColor";

interface ArcDatum {
  path: [number, number][];
  cruiseId: string;
  cruiseLine: string | null;
  status: CruiseStatus;
  color: Rgb;
  planned: boolean;
}

interface ArrowDatum {
  position: [number, number];
  angleDeg: number;
  cruiseId: string;
  color: Rgb;
  planned: boolean;
}

interface CruiseArcBuildOptions {
  /**
   * Rounded map zoom. At close range the layer renders backend
   * coordinates directly so fixed harbour and river approaches become
   * more exact as the user zooms in.
   */
  zoom?: number;
  /** User multiplier on cruise-arc line width (1 = default). */
  arcWidthScale?: number;
  /** User multiplier on the directional arrow size (1 = default). 0 hides arrows. */
  arrowSizeScale?: number;
  /**
   * The user's cruise colour mode + colours, straight from
   * `store/cruiseColorStore.ts`. THE only colour input — the pre-mode
   * `arcColor` override is gone: it used to silently flatten status/per-cruise
   * colouring into one tint, which is now the explicit `"solid"` mode instead.
   * Defaults to the status pair.
   */
  colorConfig?: CruiseColorConfig;
}

// The selected-cruise highlight stays amber, whatever the colour mode —
// "this is the one you clicked" is a different message than "this is a cruise".
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
  const colorConfig = options.colorConfig ?? DEFAULT_CRUISE_COLOR_CONFIG;
  const arcs: ArcDatum[] = [];
  for (const cruise of cruises) {
    // Effective sequence includes departure/arrival ports so minimal
    // A-to-B cruises (no detailed stop list) still draw a route.
    const ports = effectivePortSequence(cruise);

    const geometry = geometryByCruise.get(cruise.id);
    const waypointsByPair = buildWaypointIndex(geometry);
    // The user's mode + colours are the ONLY input — same resolver the globe
    // and the dashboard legend call, so the three can never disagree.
    const color = resolveCruiseArcColor(cruise, colorConfig);
    const planned = cruise.status === "scheduled";

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
        status: cruise.status,
        color,
        planned,
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
  const colorConfig = options.colorConfig ?? DEFAULT_CRUISE_COLOR_CONFIG;
  const HIGHLIGHT_COLOR = CRUISE_HIGHLIGHT_COLOR;
  const widthScale = options.arcWidthScale ?? 1;
  const DIM_ALPHA = 90;
  const FULL_ALPHA = 220;
  const PLANNED_ALPHA = 150;

  return new PathLayer<ArcDatum>({
    id: "cruise-arcs",
    data: arcs,
    getPath: (d) => d.path,
    getColor: (d) => {
      if (hasSelection && d.cruiseId === selectedCruiseId) return [...HIGHLIGHT_COLOR, FULL_ALPHA];
      const base = d.planned ? PLANNED_ALPHA : FULL_ALPHA;
      return [...d.color, hasSelection ? DIM_ALPHA : base];
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
      getColor: [selectedCruiseId, colorConfig],
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
    arrows.push({ ...anchor, cruiseId: arc.cruiseId, color: arc.color, planned: arc.planned });
  }
  const arrowSizeScale = options.arrowSizeScale ?? 1;
  if (arrows.length === 0 || arrowSizeScale <= 0) return null;

  const hasSelection = selectedCruiseId !== null;
  const colorConfig = options.colorConfig ?? DEFAULT_CRUISE_COLOR_CONFIG;
  const HIGHLIGHT_COLOR = CRUISE_HIGHLIGHT_COLOR;
  const DIM_ALPHA = 90;
  const FULL_ALPHA = 230;
  const PLANNED_ALPHA = 150;

  const iconFor = (d: ArrowDatum): { url: string; width: number; height: number } => {
    if (hasSelection && d.cruiseId === selectedCruiseId) {
      return arrowIcon(rgba(HIGHLIGHT_COLOR, FULL_ALPHA));
    }
    const alpha = hasSelection ? DIM_ALPHA : d.planned ? PLANNED_ALPHA : FULL_ALPHA;
    return arrowIcon(rgba(d.color, alpha));
  };

  return new IconLayer<ArrowDatum>({
    id: "cruise-arc-arrows",
    data: arrows,
    getPosition: (d) => d.position,
    getIcon: iconFor,
    getAngle: (d) => d.angleDeg,
    getSize: ARROW_DISPLAY_HEIGHT * arrowSizeScale,
    sizeUnits: "pixels",
    pickable: false,
    updateTriggers: {
      getIcon: [selectedCruiseId, colorConfig],
    },
  });
}

// Elongated chevron (nose at the right edge, angle 0 = pointing east) with a
// thin white border so the arrow reads clearly against both the route line
// and the basemap (#160 — Discord bug report "Pfeil auf Kreuzfahrt Routen
// ungenau"). The border is baked into the icon itself (SVG stroke) rather
// than tinted via IconLayer's getColor, since getColor multiplies the whole
// icon uniformly and would tint the border away from white too.
const ARROW_ICON_WIDTH = 22;
const ARROW_ICON_HEIGHT = 16;
// Rendered screen height in pixels — deliberately smaller than the icon's
// native size above so the border stroke stays crisp at typical map zooms.
const ARROW_DISPLAY_HEIGHT = 10;
const arrowIconCache = new Map<string, { url: string; width: number; height: number }>();

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r},${g},${b},${(alpha / 255).toFixed(3)})`;
}

function arrowIcon(fill: string): { url: string; width: number; height: number } {
  const cached = arrowIconCache.get(fill);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ARROW_ICON_WIDTH}" height="${ARROW_ICON_HEIGHT}" ` +
    `viewBox="0 0 ${ARROW_ICON_WIDTH} ${ARROW_ICON_HEIGHT}">` +
    `<path d="M 21 8 L 2 1.5 L 8.5 8 L 2 14.5 Z" fill="${fill}" stroke="white" stroke-width="1.25" stroke-linejoin="round"/>` +
    `</svg>`;
  const icon = {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: ARROW_ICON_WIDTH,
    height: ARROW_ICON_HEIGHT,
  };
  arrowIconCache.set(fill, icon);
  return icon;
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
  // deck.gl's icon/text rotation shader rotates the local (pre-flip) offset
  // and only afterwards negates its y-component, which nets out to a
  // standard y-up getAngle convention (angle 0 = pointing +x/east, positive
  // = counterclockwise on screen — verified against icon-layer-vertex.glsl.js).
  // Geographic latitude already increases "up" the same way, so the raw
  // lat delta is used directly with no extra sign flip (#160 — a previous
  // version negated dy here, which mirrored every arrow vertically).
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
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

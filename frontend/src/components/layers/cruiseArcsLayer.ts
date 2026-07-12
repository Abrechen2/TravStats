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
  // Port ids of the leg's endpoints — lets the arrow layer detect when the
  // same water is sailed in both directions (out-and-back) and de-overlap
  // the opposing arrows (see pickArrowAnchors).
  fromPortId: number;
  toPortId: number;
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
        fromPortId: a.id,
        toPortId: b.id,
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
 * Build a directional arrow IconLayer for cruise legs. Arrows are placed
 * by real-world arc length along each leg — never near either port
 * marker (see `pickArrowAnchors`) — and rotated to align with the local
 * segment direction at their anchor so the user can read the cruise's
 * flow at a glance. Short legs get one arrow at the midpoint, long legs
 * get several evenly spaced, and legs below the minimum length get none.
 *
 * Returns `null` when no arrows can be drawn (no qualifying legs, or all
 * legs too short) so callers can omit the layer rather than mounting a
 * no-op.
 */
export function createCruiseArrowsLayer(
  cruises: Cruise[],
  geometryByCruise: CruiseGeometryMap = new Map(),
  selectedCruiseId: string | null = null,
  options: CruiseArcBuildOptions = {}
): Layer | null {
  const arcs = buildCruiseArcs(cruises, geometryByCruise, options);
  // Out-and-back detection: when the SAME port pair is sailed in both
  // directions (one cruise's return leg, or two cruises passing each other),
  // both legs share one path and their midpoint arrows would stack into an
  // unreadable "X" (reported on 2.4.0-rc.1). Legs whose opposite direction
  // is also on the map get their anchors shifted toward their own journey's
  // first half, which mirrors into two arrows flanking the midpoint.
  const orderedPairKeys = new Set(arcs.map((arc) => pairKey(arc.fromPortId, arc.toPortId)));
  const arrows: ArrowDatum[] = [];
  for (const arc of arcs) {
    const hasOpposingTwin = orderedPairKeys.has(pairKey(arc.toPortId, arc.fromPortId));
    for (const anchor of pickArrowAnchors(arc.path, hasOpposingTwin)) {
      arrows.push({ ...anchor, cruiseId: arc.cruiseId, color: arc.color, planned: arc.planned });
    }
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
// The browser rasterises the SVG data-URL at the SVG's declared
// width/height, and deck.gl packs THAT bitmap into its icon atlas — so a
// 22×16 icon shown at 2.5× slider scale on a HiDPI display upsamples a
// 16-px bitmap to ~75 device pixels (reported on 2.4.0-rc.1: "Pfeile
// werden unscharf beim Skalieren"). Rasterising at 6× (132×96) keeps the
// atlas above every reachable on-screen size: 10 px base × 2.5 max slider
// × 3 devicePixelRatio = 75 ≤ 96. The geometry lives in the viewBox, so
// path and border scale losslessly.
const ARROW_RASTER_SCALE = 6;
const arrowIconCache = new Map<string, { url: string; width: number; height: number }>();

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r},${g},${b},${(alpha / 255).toFixed(3)})`;
}

function arrowIcon(fill: string): { url: string; width: number; height: number } {
  const cached = arrowIconCache.get(fill);
  if (cached) return cached;
  const width = ARROW_ICON_WIDTH * ARROW_RASTER_SCALE;
  const height = ARROW_ICON_HEIGHT * ARROW_RASTER_SCALE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${ARROW_ICON_WIDTH} ${ARROW_ICON_HEIGHT}">` +
    `<path d="M 21 8 L 2 1.5 L 8.5 8 L 2 14.5 Z" fill="${fill}" stroke="white" stroke-width="1.25" stroke-linejoin="round"/>` +
    `</svg>`;
  const icon = {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  };
  arrowIconCache.set(fill, icon);
  return icon;
}

// Earth's mean radius in km — used to convert the path's lon/lat vertices
// into a real-world leg length for arrow placement (see pickArrowAnchors).
const EARTH_RADIUS_KM = 6371;

// Legs shorter than this get no arrow at all. Below this length, any
// anchor position still visually overlaps the port markers regardless of
// where on the leg it sits — river-cruise hops and adjacent-berth
// repositioning legs land here; better to draw nothing than noise on top
// of a port icon.
const MIN_ARROW_LEG_LENGTH_KM = 30;

// Target spacing between arrows on long legs. Most cruise legs
// (Mediterranean/Baltic/Caribbean hops) are roughly 300-1000 km and are
// meant to get exactly one arrow (the n=1 case below always anchors at
// the midpoint); this interval is deliberately well above that range so
// ordinary legs never pick up a second arrow. Only genuine long crossings
// (transatlantic/repositioning, north of ~2000 km) start to.
const ARROW_LEG_INTERVAL_KM = 1500;

// Hard cap so an extreme leg (world-cruise repositioning, multi-day ocean
// crossings) doesn't spam the route with arrows.
const MAX_ARROWS_PER_LEG = 5;

/** Great-circle distance between two [lon, lat] points, in kilometers. */
function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Pick position(s) + screen-space angle(s) for directional arrow(s) along
 * a splined leg path, spaced by real-world (great-circle) arc length
 * rather than vertex index.
 *
 * Why arc length and not index: the path is a densified Catmull-Rom
 * spline, so its vertices are NOT evenly spaced — the spline places more
 * vertices where the route curves, which for harbour approaches is right
 * next to the port. The previous version anchored at
 * `path[floor(path.length * 0.88)]`, which both (a) deliberately targeted
 * a point right before the destination port and (b) compounded that by
 * indexing into the vertex-dense region near it, landing the arrow
 * visually inside the port marker on most cruise legs (reported 2.3.1:
 * "the cruise arrows all seem to sit IN the port"). Interpolating by
 * cumulative haversine distance fixes both: the anchor sits at an exact
 * fraction of the leg's real length, independent of vertex density.
 *
 * The arrow count scales with leg length (ARROW_LEG_INTERVAL_KM /
 * MAX_ARROWS_PER_LEG); for `n` arrows they're placed at fractions
 * `(i+1)/(n+1)` of the leg. This structurally guarantees a margin of
 * `length/(n+1)` from both endpoints and between adjacent arrows, and for
 * n=1 places the single arrow exactly at the midpoint — the point
 * furthest from both ports. Returns `[]` when the leg is shorter than
 * MIN_ARROW_LEG_LENGTH_KM or the path is degenerate.
 *
 * `shiftTowardStart` is set when the leg's opposite direction is also on
 * the map (out-and-back): every fraction moves a quarter-spacing toward
 * the leg's own start. Because the opposing leg runs the same water the
 * other way, the identical own-fraction shift lands on the OTHER side of
 * the shared midpoint — the two arrows flank it (n=1: 37.5% / 62.5% of
 * the path) instead of stacking into an "X", and each arrow still sits in
 * the first half of its own journey, well clear of both ports.
 */
function pickArrowAnchors(
  path: ReadonlyArray<[number, number]>,
  shiftTowardStart = false
): Array<{ position: [number, number]; angleDeg: number }> {
  if (path.length < 2) return [];

  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength < MIN_ARROW_LEG_LENGTH_KM) return [];

  const arrowCount = Math.min(
    MAX_ARROWS_PER_LEG,
    Math.max(1, Math.round(totalLength / ARROW_LEG_INTERVAL_KM))
  );

  const spacing = 1 / (arrowCount + 1);
  const fractionShift = shiftTowardStart ? -spacing / 4 : 0;
  const anchors: Array<{ position: [number, number]; angleDeg: number }> = [];
  for (let i = 0; i < arrowCount; i++) {
    const targetDist = totalLength * (spacing * (i + 1) + fractionShift);
    const anchor = interpolateAlongPath(path, cumulative, targetDist);
    if (anchor !== null) anchors.push(anchor);
  }
  return anchors;
}

/**
 * Interpolate a position + local heading at `targetDist` along `path`,
 * using `cumulative` (running haversine distance per vertex, same length
 * as `path`, `cumulative[0] === 0`). The heading comes from the segment
 * the anchor falls on, so a curved route's arrow points along the curve
 * at that point, not the leg's overall endpoint-to-endpoint direction.
 */
function interpolateAlongPath(
  path: ReadonlyArray<[number, number]>,
  cumulative: readonly number[],
  targetDist: number
): { position: [number, number]; angleDeg: number } | null {
  let segStart = 0;
  while (segStart < cumulative.length - 2 && cumulative[segStart + 1] < targetDist) segStart++;

  const [x0, y0] = path[segStart];
  const [x1, y1] = path[segStart + 1];
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

  const segLength = cumulative[segStart + 1] - cumulative[segStart];
  const t = segLength > 0 ? (targetDist - cumulative[segStart]) / segLength : 0;
  const position: [number, number] = [x0 + dx * t, y0 + dy * t];
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { position, angleDeg };
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

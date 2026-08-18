// Flat (surface) flight routes — the "flat" half of the route-shape setting
// (#183). Renders the exact same routes the ArcLayer stack renders, but as a
// deck.gl PathLayer glued to the map surface, the way cruise routes already do
// (`cruiseArcsLayer.ts`). At a home airport with dozens of departures the arcs
// converge into an unreadable funnel; flat lines stay legible at any zoom.
//
// TWO THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. COLOUR PARITY. The shape must never change the colour. Both shapes are fed
//    from the SAME `ArcDatum[]` produced by `buildRouteData` — the flat path
//    literally reuses `arc.sourceColor`, so there is no second colour code path
//    that could drift from `resolveFlightColor`.
//
// 2. THE MIXED ROUTE. A route that has BEEN flown AND carries an upcoming
//    flight is drawn as an arc by `UpcomingArcLayer`, whose injected fragment
//    shader fades the planned colour in at both tips: edge → core → edge. A
//    PathLayer has no per-vertex colour (getColor is per-path), so there is no
//    direct equivalent — and silently dropping the distinction is not an option,
//    the status colour mode and the legend both promise it.
//
//    So the flat route is SPLIT into three sub-paths that tile the same great
//    circle end to end: a planned-coloured head, the flown-coloured core, and a
//    planned-coloured tail. That is the shader's grammar expressed in geometry
//    rather than in a gradient — same information, same reading ("this route is
//    lived-in AND has more flights coming"), no fake gradient. The sub-paths
//    share their boundary vertices, so they render as one continuous line.
//    Being a hard edge rather than a fade, it is if anything easier to read at
//    the zoom levels this whole feature exists for.
//
//    In "solid" colour mode the tip colour resolves to the same colour as the
//    core (one colour means one colour) — identical to the arc, whose shader
//    then blends toward a colour it already is. Parity, not a special case.

import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { ArcDatum } from "./layerTypes";
import { greatCirclePath } from "./greatCircle";
import {
  DEFAULT_FLIGHT_COLOR_CONFIG,
  resolveFlightTipColor,
  type FlightColorConfig,
} from "../../lib/flightColor";

/** Layer id of the flat route PathLayer. Registered in `map/markerTooltip.ts`
 *  so hovering a flat route shows the same route card an arc does. */
export const FLAT_ROUTES_LAYER_ID = "routes-path";

type Rgba = [number, number, number, number];

/** Which part of a route a sub-path represents. A non-mixed route is a single
 *  `"core"` path; a mixed one is `upcoming` → `core` → `upcoming`. */
export type FlatRouteSegment = "core" | "upcoming";

export interface FlatRouteDatum {
  /** Densified great-circle vertices. Longitudes stay continuous across the
   *  antimeridian (may exceed ±180) — see `greatCircle.ts`. */
  path: [number, number][];
  segment: FlatRouteSegment;
  /** Render colour of THIS sub-path (route colour, or the planned tip colour). */
  color: Rgba;
  /** The ROUTE's colour, on every sub-path. The hover tooltip tints its
   *  "flown Nx" line from this, so a tip must not report the tip colour. */
  sourceColor: Rgba;
  count: number;
  // Threaded from ArcDatum so the shared hover tooltip can distinguish
  // flown from planned on this shape too — see routesLayer.ts.
  flownCount: number;
  scheduledCount: number;
  flightIds: string[];
  hasUpcoming: boolean;
  hasPastFlown: boolean;
  isHistorical: boolean;
  departure: ArcDatum["departure"];
  arrival: ArcDatum["arrival"];
}

/** How much of each end of a mixed route is painted in the planned colour.
 *  Mirrors the arc shader's tip weighting closely enough to read the same. */
export const FLAT_ROUTE_TIP_FRACTION = 0.2;

/**
 * Turn the arc data into flat surface paths. One path per route, except a
 * MIXED route (flown + upcoming), which becomes three: planned tip, flown core,
 * planned tip.
 */
export function buildFlatRoutes(
  arcs: ArcDatum[],
  colorConfig: FlightColorConfig = DEFAULT_FLIGHT_COLOR_CONFIG
): FlatRouteDatum[] {
  const tipRgb = resolveFlightTipColor(colorConfig);
  const out: FlatRouteDatum[] = [];

  for (const arc of arcs) {
    const { points, segments } = greatCirclePath(arc.sourcePosition, arc.targetPosition);
    const shared = {
      sourceColor: arc.sourceColor,
      count: arc.count,
      flownCount: arc.flownCount,
      scheduledCount: arc.scheduledCount,
      flightIds: arc.flightIds,
      hasUpcoming: !!arc.hasUpcoming,
      hasPastFlown: !!arc.hasPastFlown,
      isHistorical: !!arc.isHistorical,
      departure: arc.departure,
      arrival: arc.arrival,
    };
    const isMixed = !!arc.hasUpcoming && !!arc.hasPastFlown;

    if (!isMixed) {
      out.push({ ...shared, path: points, segment: "core", color: arc.sourceColor });
      continue;
    }

    // Alpha follows the route, only the hue switches at the tips — so a mixed
    // route reads as ONE line with coloured ends, not as three lines.
    const tipColor: Rgba = [tipRgb[0], tipRgb[1], tipRgb[2], arc.sourceColor[3]];
    // `segments` is a multiple of 10, so a 20 % cut always lands on a vertex.
    const head = Math.round(segments * FLAT_ROUTE_TIP_FRACTION);
    const tail = segments - head;
    // Boundary vertices are shared by the neighbouring sub-paths (slice ends are
    // inclusive of the cut index) — no seam, no gap.
    out.push(
      { ...shared, path: points.slice(0, head + 1), segment: "upcoming", color: tipColor },
      { ...shared, path: points.slice(head, tail + 1), segment: "core", color: arc.sourceColor },
      { ...shared, path: points.slice(tail), segment: "upcoming", color: tipColor }
    );
  }
  return out;
}

export interface FlatRoutesLayerOptions {
  /** Multiplier on route line width (1 = default). Same slider as the arcs. */
  widthScale?: number;
  /** Currently selected flight ids — non-selected routes dim, selected ones
   *  take the amber highlight. Identical semantics to the arc layers. */
  selectedIds?: string[];
  /** Amber highlight for selected routes. Passed in so the arc + flat shapes
   *  cannot drift apart on it. */
  highlightColor: Rgba;
  /** Alpha for routes dimmed by an active selection. */
  dimAlpha: number;
  onFlightClick?: (flightIds: string[]) => void;
}

/**
 * The flat-route PathLayer. Mirrors the arc layers' width ramp, selection
 * highlight/dim and click handling so switching shape changes nothing but the
 * geometry.
 */
export function createFlatRoutesLayer(
  routes: FlatRouteDatum[],
  widthFor: (count: number, isHistorical: boolean, selected: boolean) => number,
  options: FlatRoutesLayerOptions
): Layer {
  const { widthScale = 1, selectedIds = [], highlightColor, dimAlpha, onFlightClick } = options;
  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  const isSelected = (d: FlatRouteDatum): boolean => d.flightIds.some((id) => selectedSet.has(id));

  return new PathLayer<FlatRouteDatum>({
    id: FLAT_ROUTES_LAYER_ID,
    data: routes,
    getPath: (d) => d.path,
    getColor: (d): Rgba => {
      if (!hasSelection) return d.color;
      if (isSelected(d)) return highlightColor;
      return [d.color[0], d.color[1], d.color[2], dimAlpha];
    },
    getWidth: (d) => widthFor(d.count, d.isHistorical, hasSelection && isSelected(d)),
    widthUnits: "pixels",
    // Same visibility floor as the arcs: a single far-flung route stays
    // readable at world zoom instead of thinning to a hairline.
    widthMinPixels: 2 * widthScale,
    capRounded: true,
    jointRounded: true,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }: { object?: FlatRouteDatum }) => {
          const ids = object?.flightIds;
          if (ids && ids.length > 0) onFlightClick(ids);
        }
      : undefined,
    updateTriggers: {
      getColor: selectedIds,
      getWidth: selectedIds,
    },
  });
}

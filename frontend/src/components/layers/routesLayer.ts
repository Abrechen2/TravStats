import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { ArcDatum, PointDatum } from "./layerTypes";
import type { MapLayerColors } from "../../types/mapTheme";
import { UpcomingArcLayer } from "./UpcomingArcLayer";

function routeKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

function getCoordsFromFeature(
  f: GeoJSONFeature
): { depCoord: [number, number]; arrCoord: [number, number] } | null {
  const coords = f.geometry.coordinates;
  if (!coords || coords.length < 2) return null;
  return {
    depCoord: coords[0] as [number, number],
    arrCoord: coords[coords.length - 1] as [number, number],
  };
}

// Soft grey for routes whose only flights are historical (legacy, no longer
// active). Still useful to render so the user sees them dim in the background.
const HISTORICAL_COLOR: [number, number, number] = [150, 150, 150];
const HISTORICAL_ALPHA = 140;

// Sky-blue for pure-scheduled (never-flown) routes. Matches EDGE_COLOR_GLSL
// in UpcomingArcLayer: 0.3137 * 255 ≈ 80, 0.7843 * 255 ≈ 200, 1.0 * 255 = 255.
export const SCHEDULED_BLUE: [number, number, number] = [80, 200, 255];
// Two-tier red for mixed-route (flown + scheduled) cores. Below median
// frequency: lighter red (Tailwind red-400). At/above median: deeper red
// (Tailwind red-600). The blue tips of UpcomingArcLayer fade these in.
export const MIXED_RED_LOW: [number, number, number] = [248, 113, 113];
export const MIXED_RED_HIGH: [number, number, number] = [220, 38, 38];


interface RouteRecord {
  key: string;
  // First-seen coordinates for this canonical route. Either direction of
  // FRA-MUC vs MUC-FRA collapses to the same record, so the arc uses the
  // first-seen flight's geometry — that's fine for a directionless display.
  depCoord: [number, number];
  arrCoord: [number, number];
  count: number;
  flightIds: string[];
  hasUpcoming: boolean;
  // True when at least one flight on this canonical pair has status !==
  // 'scheduled' (i.e. it has actually been flown — flown / cancelled /
  // historical / duplicated all count). Combined with `hasUpcoming` to
  // distinguish "pure-scheduled" (blue) from "mixed" (blue-tipped red).
  hasPastFlown: boolean;
  // True when every flight on this canonical pair is `status: 'historical'`.
  // Used to fade the arc to the dim grey treatment.
  allHistorical: boolean;
}

function aggregateAllRoutes(flights: GeoJSONFeature[]): Map<string, RouteRecord> {
  const records = new Map<string, RouteRecord>();
  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    if (!dep.iata || !arr.iata) continue;
    const coords = getCoordsFromFeature(f);
    if (!coords) continue;
    const key = routeKey(dep.iata, arr.iata);
    const isScheduled = f.properties.status === "scheduled";
    const isHistorical = f.properties.status === "historical";
    const existing = records.get(key);
    if (existing) {
      existing.count += 1;
      existing.flightIds.push(f.properties.id);
      if (isScheduled) existing.hasUpcoming = true;
      if (!isScheduled) existing.hasPastFlown = true;
      if (!isHistorical) existing.allHistorical = false;
    } else {
      records.set(key, {
        key,
        depCoord: coords.depCoord,
        arrCoord: coords.arrCoord,
        count: 1,
        flightIds: [f.properties.id],
        hasUpcoming: isScheduled,
        hasPastFlown: !isScheduled,
        allHistorical: isHistorical,
      });
    }
  }
  return records;
}

function buildArcs(
  records: Map<string, RouteRecord>,
  minRouteCount: number,
  themeColors?: MapLayerColors,
  /**
   * Monochrome color override applied to every route — supersedes the
   * heatmap branch so callers can project all flights in a single domain
   * hue. The Alle tab uses this to separate flight-amber arcs from the
   * separate cruise-blue overlay arcs cleanly. Historical routes still
   * fall back to grey, since "this is older legacy data" is a
   * cross-domain semantic the override shouldn't suppress.
   */
  paletteOverride?: [number, number, number]
): ArcDatum[] {
  const counts = [...records.values()].map((r) => r.count);
  const { q25, q50, q75 } = calcQuantiles(counts.length > 0 ? counts : [0]);
  const arcs: ArcDatum[] = [];

  for (const r of records.values()) {
    if (r.count < minRouteCount) continue;

    // Four-way category resolution. Priority:
    //   1. allHistorical — dim grey, lowest precedence.
    //   2. pure-scheduled (hasUpcoming && !hasPastFlown) — solid sky-blue,
    //      rendered through plain ArcLayer (no shader inject).
    //   3. mixed (hasUpcoming && hasPastFlown) — hardcoded 2-tier red core,
    //      rendered through UpcomingArcLayer which fades blue at both ends.
    //   4. regular past-only — frequency-driven heatmap, or paletteOverride
    //      when the caller wants to force a domain-specific palette (e.g.
    //      cruise routes use a different palette than flight heatmaps).
    let color: [number, number, number];
    let alpha: number;

    if (r.allHistorical) {
      color = HISTORICAL_COLOR;
      alpha = HISTORICAL_ALPHA;
    } else if (r.hasUpcoming && !r.hasPastFlown) {
      // Pure-scheduled — never-flown route with an upcoming flight. Solid
      // sky-blue across the whole arc, no shader gradient.
      color = SCHEDULED_BLUE;
      alpha = Math.min(140 + r.count * 14, 230);
    } else if (r.hasUpcoming && r.hasPastFlown) {
      // Mixed — hardcoded 2-tier red core; UpcomingArcLayer fades blue at
      // both ends. Below median frequency: red-400. At/above median:
      // red-600.
      color = r.count <= q50 ? MIXED_RED_LOW : MIXED_RED_HIGH;
      alpha = Math.min(100 + r.count * 14, 230);
    } else {
      // Regular past-only — frequency-driven heatmap, or domain-scoped
      // palette when the caller passes paletteOverride.
      color = paletteOverride ?? getHeatmapColor(r.count, q25, q50, q75, themeColors);
      alpha = Math.min(100 + r.count * 14, 230);
    }

    // sourceColor === targetColor: arc is uniform colour at the data layer.
    // Mixed-route blue tips are added by UpcomingArcLayer's fragment shader.
    const argb = [...color, alpha] as [number, number, number, number];
    arcs.push({
      sourcePosition: r.depCoord,
      targetPosition: r.arrCoord,
      count: r.count,
      sourceColor: argb,
      targetColor: argb,
      flightIds: r.flightIds,
      hasUpcoming: r.hasUpcoming,
      hasPastFlown: r.hasPastFlown,
      isHistorical: r.allHistorical,
    });
  }
  return arcs;
}

function buildAirportPoints(flights: GeoJSONFeature[]): PointDatum[] {
  const airportMap = new Map<string, PointDatum>();
  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!dep.iata || !arr.iata || !coords) continue;

    if (!airportMap.has(dep.iata)) {
      airportMap.set(dep.iata, {
        position: coords.depCoord,
        count: 0,
        name: dep.name ?? dep.iata,
        iata: dep.iata,
      });
    }
    if (!airportMap.has(arr.iata)) {
      airportMap.set(arr.iata, {
        position: coords.arrCoord,
        count: 0,
        name: arr.name ?? arr.iata,
        iata: arr.iata,
      });
    }
    const depPoint = airportMap.get(dep.iata)!;
    const arrPoint = airportMap.get(arr.iata)!;
    airportMap.set(dep.iata, { ...depPoint, count: depPoint.count + 1 });
    airportMap.set(arr.iata, { ...arrPoint, count: arrPoint.count + 1 });
  }
  return [...airportMap.values()];
}

export interface RouteData {
  arcs: ArcDatum[];
  points: PointDatum[];
}

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors,
  paletteOverride?: [number, number, number]
): RouteData {
  // Single arc per canonical airport pair (FRA-MUC === MUC-FRA), regardless
  // of whether the route carries past, scheduled, or mixed flights. Frequency
  // drives width + colour. Arcs that carry at least one scheduled flight get
  // a soft outer casing layer rendered behind them — signal lives on the arc
  // itself, not as a separate dot, and reads as a halo without competing
  // with the heatmap.
  const records = aggregateAllRoutes(flights);
  return {
    arcs: buildArcs(records, minRouteCount, themeColors, paletteOverride),
    points: buildAirportPoints(flights),
  };
}

// Amber highlight color — stands out clearly against both dark and light map tiles
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
// How many alpha units to keep for dimmed routes (out of 255)
const DIM_ALPHA = 18;

/**
 * Below this zoom, IATA labels are hidden — at low zoom levels (world view)
 * dozens of three-letter codes overlap into illegible noise. The marker
 * dots stay visible, so users still see where airports are. Above this
 * threshold there's enough screen space for the labels to read cleanly.
 */
const LABEL_VISIBILITY_MIN_ZOOM = 4;

/**
 * Build the deck.gl layer instances for routes mode from already-computed
 * arc + point + upcoming-marker data. Caller is expected to memoize
 * `buildRouteData()`'s output separately with stable deps (flights /
 * minRouteCount / themeColors / paletteOverride) so selection changes don't
 * re-trigger the expensive data build — only the layer construction below,
 * which is cheap.
 */
export function createRoutesLayers(
  routeData: RouteData,
  onFlightClick?: (flightId: string | string[]) => void,
  themeColors?: MapLayerColors,
  arcHeight: number = 1,
  selectedIds: string[] = [],
  onAirportClick?: (iata: string, lon: number, lat: number) => void,
  zoom: number = 5
): Layer[] {
  const { arcs, points } = routeData;
  const dotRgb = themeColors?.airportDot ?? ([240, 169, 71] as [number, number, number]);

  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  // Airport opacity: dim when a route is highlighted so pulse rings stand out
  const airportOpacity = hasSelection ? 0.15 : 1;
  const labelsVisible = zoom >= LABEL_VISIBILITY_MIN_ZOOM;

  // Three arc datasets:
  //   - regular: no upcoming flight — heatmap colour through plain ArcLayer.
  //   - pure-scheduled: upcoming, never flown — solid sky-blue through
  //     plain ArcLayer (no shader gradient).
  //   - mixed: upcoming AND has been flown — hardcoded red core through
  //     UpcomingArcLayer which fades blue at both ends.
  // Each route appears exactly once on screen (one line, no overlap).
  const regularArcs = arcs.filter((a) => !a.hasUpcoming);
  const pureScheduledArcs = arcs.filter((a) => a.hasUpcoming && !a.hasPastFlown);
  const mixedArcs = arcs.filter((a) => a.hasUpcoming && a.hasPastFlown);

  // Shared arc props: width, source/target getters, click handler. Used by
  // both the regular and the upcoming layer.
  const sharedArcProps = {
    getSourcePosition: (d: ArcDatum) => d.sourcePosition,
    getTargetPosition: (d: ArcDatum) => d.targetPosition,
    getSourceColor: (d: ArcDatum): [number, number, number, number] => {
      if (!hasSelection) return d.sourceColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.sourceColor[0], d.sourceColor[1], d.sourceColor[2], DIM_ALPHA];
    },
    getTargetColor: (d: ArcDatum): [number, number, number, number] => {
      if (!hasSelection) return d.targetColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.targetColor[0], d.targetColor[1], d.targetColor[2], DIM_ALPHA];
    },
    getWidth: (d: ArcDatum) => {
      // Width follows frequency for live routes; historical-only routes stay
      // visually muted regardless of count so they don't drown out active
      // ones. Cap at 4 px (was 7) — multiplier dropped from 1.3 to 1.0 so
      // 1 flight = 1 px, 16 flights = max 4 px (smooth ramp across realistic
      // counts).
      if (d.isHistorical) return 1.2;
      const base = Math.min(Math.sqrt(d.count) * 1.0, 4);
      if (!hasSelection) return base;
      // Selected fallback floor matches the new max so a selected mixed
      // route doesn't pop bigger than the unselected cap.
      return d.flightIds.some((id) => selectedSet.has(id)) ? Math.max(base * 2, 4) : base;
    },
    getHeight: arcHeight,
    widthMinPixels: 1,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }: { object?: ArcDatum }) => {
          const ids = object?.flightIds;
          if (ids && ids.length > 0) onFlightClick(ids);
        }
      : undefined,
    updateTriggers: {
      getSourceColor: selectedIds,
      getTargetColor: selectedIds,
      getWidth: selectedIds,
    },
  };

  const arcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc",
    data: regularArcs,
    ...sharedArcProps,
  });

  // Pure-scheduled routes — never flown, only an upcoming flight on this
  // pair. Solid sky-blue, no shader gradient.
  const scheduledArcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc-scheduled",
    data: pureScheduledArcs,
    ...sharedArcProps,
  });

  // Mixed routes — already flown AND carry an upcoming flight. Red core
  // (data layer), blue tips (UpcomingArcLayer fragment shader). Layer id
  // kept as `routes-arc-upcoming` for layer-state continuity (selection
  // state, picking buffers).
  const upcomingArcLayer = new UpcomingArcLayer<ArcDatum>({
    id: "routes-arc-upcoming",
    data: mixedArcs,
    ...sharedArcProps,
  });

  // Inner ring — close to the airport dot
  const ringInnerLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-ring-inner",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1000,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...dotRgb, 180] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 1.2,
    opacity: airportOpacity,
    pickable: false,
  });

  // Outer ring — faint halo
  const ringOuterLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-ring-outer",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1800,
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...dotRgb, 60] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 0.8,
    opacity: airportOpacity,
    pickable: false,
  });

  // Inner dot — solid center marker
  const dotLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-dot",
    data: points,
    getPosition: (d) => d.position,
    getRadius: () => 2200,
    getFillColor: [...dotRgb, 220] as [number, number, number, number],
    stroked: false,
    opacity: airportOpacity,
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
  });

  // IATA code labels — appear above each marker. Hidden at low zoom levels
  // where overlapping codes become illegible; the marker dots remain visible
  // so users still see airport locations.
  const labelLayer = new TextLayer<PointDatum>({
    id: "routes-labels",
    data: points,
    getPosition: (d) => d.position,
    getText: (d) => d.iata,
    getSize: 12,
    getColor: [255, 255, 255, 240],
    getBackgroundColor: [22, 27, 34, 210],
    background: true,
    backgroundPadding: [5, 3, 5, 3],
    fontFamily: '"Inter", system-ui, monospace',
    fontWeight: "bold",
    getPixelOffset: [0, -20],
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 120],
    billboard: true,
    characterSet: "auto",
    opacity: airportOpacity,
    visible: labelsVisible,
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
    parameters: { depthCompare: "always" as const },
  });

  // Render order: regular arcs first, then pure-scheduled (sky-blue solids),
  // then mixed (gradient on top in case of stacked picking), then airport
  // visuals.
  return [
    arcLayer,
    scheduledArcLayer,
    upcomingArcLayer,
    ringInnerLayer,
    ringOuterLayer,
    dotLayer,
    labelLayer,
  ];
}

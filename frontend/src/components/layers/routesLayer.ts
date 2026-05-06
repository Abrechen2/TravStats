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
      if (!isHistorical) existing.allHistorical = false;
    } else {
      records.set(key, {
        key,
        depCoord: coords.depCoord,
        arrCoord: coords.arrCoord,
        count: 1,
        flightIds: [f.properties.id],
        hasUpcoming: isScheduled,
        allHistorical: isHistorical,
      });
    }
  }
  return records;
}

function buildArcs(
  records: Map<string, RouteRecord>,
  minRouteCount: number,
  themeColors?: MapLayerColors
): ArcDatum[] {
  const counts = [...records.values()].map((r) => r.count);
  const { q25, q50, q75 } = calcQuantiles(counts.length > 0 ? counts : [0]);
  const arcs: ArcDatum[] = [];

  for (const r of records.values()) {
    if (r.count < minRouteCount) continue;

    const alpha = r.allHistorical
      ? HISTORICAL_ALPHA
      : (Math.min(100 + r.count * 14, 230) as number);
    const color = r.allHistorical
      ? HISTORICAL_COLOR
      : getHeatmapColor(r.count, q25, q50, q75, themeColors);

    // sourceColor === targetColor: arc is uniform heatmap colour,
    // directionless. The "scheduled" signal lives in the rendering layer:
    // upcoming arcs go through UpcomingArcLayer which mixes blue at both
    // ends via fragment shader. No per-instance colour shift here.
    const argb = [...color, alpha] as [number, number, number, number];
    arcs.push({
      sourcePosition: r.depCoord,
      targetPosition: r.arrCoord,
      count: r.count,
      sourceColor: argb,
      targetColor: argb,
      flightIds: r.flightIds,
      hasUpcoming: r.hasUpcoming,
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

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors
): {
  arcs: ArcDatum[];
  points: PointDatum[];
} {
  // Single arc per canonical airport pair (FRA-MUC === MUC-FRA), regardless
  // of whether the route carries past, scheduled, or mixed flights. Frequency
  // drives width + colour. Arcs that carry at least one scheduled flight get
  // a soft outer casing layer rendered behind them — signal lives on the arc
  // itself, not as a separate dot, and reads as a halo without competing
  // with the heatmap.
  const records = aggregateAllRoutes(flights);
  return {
    arcs: buildArcs(records, minRouteCount, themeColors),
    points: buildAirportPoints(flights),
  };
}

// Amber highlight color — stands out clearly against both dark and light map tiles
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
// How many alpha units to keep for dimmed routes (out of 255)
const DIM_ALPHA = 18;

export function createRoutesLayers(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  onFlightClick?: (flightId: string | string[]) => void,
  themeColors?: MapLayerColors,
  arcHeight: number = 1,
  selectedIds: string[] = [],
  onAirportClick?: (iata: string, lon: number, lat: number) => void
): Layer[] {
  const { arcs, points } = buildRouteData(flights, minRouteCount, themeColors);
  const dotRgb = themeColors?.airportDot ?? ([232, 160, 69] as [number, number, number]);

  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  // Airport opacity: dim when a route is highlighted so pulse rings stand out
  const airportOpacity = hasSelection ? 0.15 : 1;

  // Two arc datasets — non-upcoming render through the regular ArcLayer,
  // upcoming render through UpcomingArcLayer which adds the symmetric
  // blue-tip gradient via a fragment-shader inject. Each route still
  // appears exactly once on screen (one line, no overlap).
  const nonUpcomingArcs = arcs.filter((a) => !a.hasUpcoming);
  const upcomingArcs = arcs.filter((a) => a.hasUpcoming);

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
      // ones.
      if (d.isHistorical) return 1.2;
      const base = Math.min(Math.sqrt(d.count) * 1.3, 7);
      if (!hasSelection) return base;
      return d.flightIds.some((id) => selectedSet.has(id)) ? Math.max(base * 2, 5) : base;
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
    data: nonUpcomingArcs,
    ...sharedArcProps,
  });

  // Upcoming routes — same arc geometry, custom shader fades the heatmap
  // colour to sky-blue at both ends (symmetric "Zahnpasta" gradient).
  const upcomingArcLayer = new UpcomingArcLayer<ArcDatum>({
    id: "routes-arc-upcoming",
    data: upcomingArcs,
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

  // IATA code labels — appear above each marker
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
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
    parameters: { depthCompare: "always" as const },
  });

  // Render order: regular arcs first, then upcoming arcs (so the blue-tip
  // gradient sits on top in case of stacked picking), then airport visuals.
  return [arcLayer, upcomingArcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}

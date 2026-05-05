import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { ArcDatum, PointDatum, UpcomingMarkerDatum } from "./layerTypes";
import type { MapLayerColors } from "../../types/mapTheme";

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
  // Departure IATA on the most-recently-added scheduled flight, used to
  // anchor the upcoming-marker label.
  upcomingIata: string | null;
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
      if (isScheduled) {
        existing.hasUpcoming = true;
        existing.upcomingIata = dep.iata;
      }
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
        upcomingIata: isScheduled ? dep.iata : null,
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

    const alpha = r.allHistorical
      ? HISTORICAL_ALPHA
      : (Math.min(100 + r.count * 14, 230) as number);
    const color = r.allHistorical
      ? HISTORICAL_COLOR
      : (paletteOverride ?? getHeatmapColor(r.count, q25, q50, q75, themeColors));

    // sourceColor === targetColor: no gradient, the route is directionless
    // and a same-colour arc reads as a single visual unit — frequency lives
    // in width and colour brightness, not direction.
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

function midpointLonLat(a: [number, number], b: [number, number]): [number, number] {
  // Naïve 2D midpoint — fine for the indicator marker on most routes.
  // Long routes that cross the antimeridian (lon-delta > 180) would put
  // the marker on the opposite side of the globe; offset back into the
  // wrap-aware midpoint so the marker still sits visually on the arc.
  let lonA = a[0];
  let lonB = b[0];
  if (Math.abs(lonB - lonA) > 180) {
    if (lonA < lonB) lonA += 360;
    else lonB += 360;
  }
  let lon = (lonA + lonB) / 2;
  if (lon > 180) lon -= 360;
  return [lon, (a[1] + b[1]) / 2];
}

function buildUpcomingMarkers(records: Map<string, RouteRecord>): UpcomingMarkerDatum[] {
  const markers: UpcomingMarkerDatum[] = [];
  for (const r of records.values()) {
    if (!r.hasUpcoming) continue;
    markers.push({
      position: midpointLonLat(r.depCoord, r.arrCoord),
      iata: r.upcomingIata ?? "",
      count: r.count,
      flightIds: r.flightIds,
    });
  }
  return markers;
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
  upcomingMarkers: UpcomingMarkerDatum[];
}

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors,
  paletteOverride?: [number, number, number]
): RouteData {
  // Single arc per canonical airport pair (FRA-MUC === MUC-FRA), regardless
  // of whether the route carries past, scheduled, or mixed flights. Frequency
  // drives width + colour; the "has-upcoming" signal moves to a separate
  // midpoint marker layer (shape, not colour) so the heatmap stays readable
  // and accessibility doesn't depend on a colour that some users won't see.
  const records = aggregateAllRoutes(flights);
  return {
    arcs: buildArcs(records, minRouteCount, themeColors, paletteOverride),
    points: buildAirportPoints(flights),
    upcomingMarkers: buildUpcomingMarkers(records),
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
  const { arcs, points, upcomingMarkers } = routeData;
  const dotRgb = themeColors?.airportDot ?? ([240, 169, 71] as [number, number, number]);

  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  // Airport opacity: dim when a route is highlighted so pulse rings stand out
  const airportOpacity = hasSelection ? 0.15 : 1;
  const labelsVisible = zoom >= LABEL_VISIBILITY_MIN_ZOOM;

  // Arc width scales with route frequency. Selected arc is visually thicker.
  const arcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc",
    data: arcs,
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => {
      if (!hasSelection) return d.sourceColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.sourceColor[0], d.sourceColor[1], d.sourceColor[2], DIM_ALPHA] as [
        number,
        number,
        number,
        number,
      ];
    },
    getTargetColor: (d) => {
      if (!hasSelection) return d.targetColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.targetColor[0], d.targetColor[1], d.targetColor[2], DIM_ALPHA] as [
        number,
        number,
        number,
        number,
      ];
    },
    getWidth: (d) => {
      // Width follows frequency for live routes; historical-only routes stay
      // visually muted regardless of count so they don't drown out active
      // ones. has-upcoming has its own marker — width should not also encode
      // that, otherwise the same dimension carries two signals.
      if (d.isHistorical) return 1.2;
      const base = Math.min(Math.sqrt(d.count) * 1.3, 7);
      if (!hasSelection) return base;
      return d.flightIds.some((id) => selectedSet.has(id)) ? Math.max(base * 2, 5) : base;
    },
    getHeight: arcHeight,
    widthMinPixels: 1,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }) => {
          const ids = object?.flightIds;
          if (ids && ids.length > 0) onFlightClick(ids);
        }
      : undefined,
    updateTriggers: {
      getSourceColor: selectedIds,
      getTargetColor: selectedIds,
      getWidth: selectedIds,
    },
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

  // Upcoming-flight indicator at the midpoint of every route that carries
  // a scheduled flight. A small, bright cyan-bordered dot — distinct shape
  // and brightness so users with limited colour vision still pick up the
  // signal. Render order: AFTER the arc so the marker sits on top.
  const UPCOMING_FILL: [number, number, number, number] = [100, 200, 220, 230];
  const UPCOMING_STROKE: [number, number, number, number] = [255, 255, 255, 240];
  const upcomingMarkerLayer = new ScatterplotLayer<UpcomingMarkerDatum>({
    id: "routes-upcoming-marker",
    data: upcomingMarkers,
    getPosition: (d) => d.position,
    getRadius: 1500,
    getFillColor: (d) => {
      if (!hasSelection) return UPCOMING_FILL;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      return isSelected
        ? HIGHLIGHT_COLOR
        : ([UPCOMING_FILL[0], UPCOMING_FILL[1], UPCOMING_FILL[2], DIM_ALPHA] as [
            number,
            number,
            number,
            number,
          ]);
    },
    getLineColor: UPCOMING_STROKE,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 1.5,
    radiusMinPixels: 4,
    radiusMaxPixels: 7,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }) => {
          const ids = object?.flightIds;
          if (ids && ids.length > 0) onFlightClick(ids);
        }
      : undefined,
    updateTriggers: {
      getFillColor: selectedIds,
    },
  });

  return [arcLayer, upcomingMarkerLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}

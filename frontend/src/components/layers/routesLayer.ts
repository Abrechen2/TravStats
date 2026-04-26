import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { ArcDatum, PointDatum } from "./layerTypes";
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

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  themeColors?: MapLayerColors,
  /**
   * Monochrome color override applied to every route — supersedes the
   * hardcoded scheduled-cyan / historical-grey branches so callers can
   * project all flights in a single domain hue (Alle-tab needs this to
   * separate pink flights from sky-blue cruises cleanly). Alpha still
   * varies per status: scheduled=180, historical=140, flown=count-scaled.
   */
  paletteOverride?: [number, number, number]
): { arcs: ArcDatum[]; points: PointDatum[] } {
  const routeCounts = new Map<string, number>();
  const routeFlightIds = new Map<string, string[]>();
  const airportMap = new Map<string, PointDatum>();

  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!dep.iata || !arr.iata || !coords) continue;

    const key = routeKey(dep.iata, arr.iata);
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);

    const ids = routeFlightIds.get(key) ?? [];
    ids.push(f.properties.id);
    routeFlightIds.set(key, ids);

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

  const counts = [...routeCounts.values()];
  const { q25, q50, q75 } = calcQuantiles(counts.length > 0 ? counts : [0]);
  const arcMap = new Map<string, ArcDatum>();

  // Pre-build flightId -> status lookup so the per-route status check below
  // is O(1) per flight instead of O(F) per lookup. The previous .every()
  // over route flights × .some() over the full flights array was O(F²)
  // — measurable on the demo account (~160 flights = ~128k comparisons
  // per render). With a Map this collapses to a single linear pass.
  const statusById = new Map<string, string | undefined>();
  for (const f of flights) statusById.set(f.properties.id, f.properties.status);

  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!dep.iata || !arr.iata || !coords) continue;

    const key = routeKey(dep.iata, arr.iata);
    const count = routeCounts.get(key) ?? 0;
    if (count < minRouteCount || arcMap.has(key)) continue;

    // Check if all flights on this route are scheduled (future/planned)
    const flightIdsForRoute = routeFlightIds.get(key) ?? [];
    const allScheduled = flightIdsForRoute.every((fid) => statusById.get(fid) === "scheduled");
    const allHistorical = flightIdsForRoute.every((fid) => statusById.get(fid) === "historical");

    // Scheduled-only routes: dashed cyan/teal; historical: grey; mixed/flown: normal heatmap color.
    // When a paletteOverride is active, collapse all three branches
    // into that single hue — alpha still encodes status to keep
    // scheduled/historical visually distinguishable.
    const alpha = allScheduled
      ? 180
      : allHistorical
        ? 140
        : (Math.min(100 + count * 14, 230) as number);
    const color = paletteOverride
      ? paletteOverride
      : allScheduled
        ? ([100, 200, 220] as [number, number, number]) // cyan/teal for scheduled
        : allHistorical
          ? ([150, 150, 150] as [number, number, number]) // grey for historical
          : getHeatmapColor(count, q25, q50, q75, themeColors);
    arcMap.set(key, {
      sourcePosition: coords.depCoord,
      targetPosition: coords.arrCoord,
      count,
      sourceColor: [...color, alpha] as [number, number, number, number],
      targetColor: [...color, alpha] as [number, number, number, number],
      flightIds: flightIdsForRoute,
      isScheduled: allScheduled,
      isHistorical: allHistorical,
    });
  }

  return { arcs: [...arcMap.values()], points: [...airportMap.values()] };
}

// Amber highlight color — stands out clearly against both dark and light map tiles
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
// How many alpha units to keep for dimmed routes (out of 255)
const DIM_ALPHA = 18;

/**
 * Build the deck.gl layer instances for routes mode from already-computed
 * arc + point data. Caller is expected to memoize buildRouteData()'s output
 * separately with stable deps (flights / minRouteCount / themeColors /
 * paletteOverride) so selection changes don't re-trigger the expensive
 * data build — only the layer construction below, which is cheap.
 */
/**
 * Below this zoom, IATA labels are hidden — at low zoom levels (world view)
 * dozens of three-letter codes overlap into illegible noise. The marker
 * dots stay visible, so users still see where airports are. Above this
 * threshold there's enough screen space for the labels to read cleanly.
 */
const LABEL_VISIBILITY_MIN_ZOOM = 4;

export function createRoutesLayers(
  routeData: { arcs: ArcDatum[]; points: PointDatum[] },
  onFlightClick?: (flightId: string | string[]) => void,
  themeColors?: MapLayerColors,
  arcHeight: number = 1,
  selectedIds: string[] = [],
  onAirportClick?: (iata: string, lon: number, lat: number) => void,
  zoom: number = 5
): Layer[] {
  const { arcs, points } = routeData;
  const dotRgb = themeColors?.airportDot ?? ([232, 160, 69] as [number, number, number]);

  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  // Airport opacity: dim when a route is highlighted so pulse rings stand out
  const airportOpacity = hasSelection ? 0.15 : 1;

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
      if (d.isScheduled) return 1.5; // thin dashed-look for planned routes
      if (d.isHistorical) return 1.2; // slightly thin for historical routes
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

  // IATA code labels — appear above each marker. Hidden at low zoom
  // levels where they'd overlap into illegible clutter, and during a
  // selection so highlighted arcs remain visually dominant.
  const labelsVisible = zoom >= LABEL_VISIBILITY_MIN_ZOOM && !hasSelection;

  const labelLayer = new TextLayer<PointDatum>({
    id: "routes-labels",
    data: points,
    visible: labelsVisible,
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

  return [arcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}

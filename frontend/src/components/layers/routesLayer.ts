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
  themeColors?: MapLayerColors
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

  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!dep.iata || !arr.iata || !coords) continue;

    const key = routeKey(dep.iata, arr.iata);
    const count = routeCounts.get(key) ?? 0;
    if (count < minRouteCount || arcMap.has(key)) continue;

    // Opacity scales with frequency: rare routes fade back, frequent ones glow
    const alpha = Math.min(100 + count * 14, 230) as number;
    const color = getHeatmapColor(count, q25, q50, q75, themeColors);
    arcMap.set(key, {
      sourcePosition: coords.depCoord,
      targetPosition: coords.arrCoord,
      count,
      sourceColor: [...color, alpha] as [number, number, number, number],
      targetColor: [...color, alpha] as [number, number, number, number],
      flightIds: routeFlightIds.get(key) ?? [],
    });
  }

  return { arcs: [...arcMap.values()], points: [...airportMap.values()] };
}

export function createRoutesLayers(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  onFlightClick?: (flightId: string) => void,
  themeColors?: MapLayerColors
): Layer[] {
  const { arcs, points } = buildRouteData(flights, minRouteCount, themeColors);
  const dotRgb = themeColors?.airportDot ?? ([232, 160, 69] as [number, number, number]);

  // Arc width scales with route frequency — dominant corridors are visually thicker
  const arcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc",
    data: arcs,
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => d.sourceColor,
    getTargetColor: (d) => d.targetColor,
    getWidth: (d) => Math.min(Math.sqrt(d.count) * 1.3, 7),
    widthMinPixels: 1,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }) => {
          const lastId = object?.flightIds.at(-1);
          if (lastId) onFlightClick(lastId);
        }
      : undefined,
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
    pickable: false,
  });

  // IATA code labels — appear above each marker
  const labelLayer = new TextLayer<PointDatum>({
    id: "routes-labels",
    data: points,
    getPosition: (d) => d.position,
    getText: (d) => d.iata,
    getSize: 11,
    getColor: [230, 230, 230, 220],
    getBackgroundColor: [13, 17, 23, 170],
    background: true,
    backgroundPadding: [4, 2, 4, 2],
    fontFamily: '"Inter", system-ui, monospace',
    fontWeight: "bold",
    getPixelOffset: [0, -18],
    billboard: true,
    characterSet: "auto",
  });

  return [arcLayer, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}

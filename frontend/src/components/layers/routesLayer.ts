import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { ArcDatum, PointDatum } from "./layerTypes";

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
  minRouteCount: number
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

    const color = getHeatmapColor(count, q25, q50, q75);
    arcMap.set(key, {
      sourcePosition: coords.depCoord,
      targetPosition: coords.arrCoord,
      count,
      sourceColor: [...color, 200] as [number, number, number, number],
      targetColor: [...color, 200] as [number, number, number, number],
      flightIds: routeFlightIds.get(key) ?? [],
    });
  }

  return { arcs: [...arcMap.values()], points: [...airportMap.values()] };
}

export function createRoutesLayers(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  onFlightClick?: (flightId: string) => void
): [ArcLayer<ArcDatum>, ScatterplotLayer<PointDatum>] {
  const { arcs, points } = buildRouteData(flights, minRouteCount);

  const arcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc",
    data: arcs,
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => d.sourceColor,
    getTargetColor: (d) => d.targetColor,
    getWidth: 1.5,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }) => {
          const lastId = object?.flightIds.at(-1);
          if (lastId) onFlightClick(lastId);
        }
      : undefined,
  });

  const scatterLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-scatter",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1000,
    getFillColor: [232, 160, 69, 150],
    pickable: false,
  });

  return [arcLayer, scatterLayer];
}

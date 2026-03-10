import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles, getHeatmapColor } from "./layerTypes";
import type { ArcDatum, PointDatum } from "./layerTypes";

function routeKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number
): { arcs: ArcDatum[]; points: PointDatum[] } {
  const routeCounts = new Map<string, number>();
  const airportMap = new Map<string, PointDatum>();

  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    if (
      !dep.iata ||
      !arr.iata ||
      dep.lon == null ||
      dep.lat == null ||
      arr.lon == null ||
      arr.lat == null
    )
      continue;

    const key = routeKey(dep.iata, arr.iata);
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);

    if (!airportMap.has(dep.iata)) {
      airportMap.set(dep.iata, {
        position: [dep.lon, dep.lat],
        count: 0,
        name: dep.name ?? dep.iata,
        iata: dep.iata,
      });
    }
    if (!airportMap.has(arr.iata)) {
      airportMap.set(arr.iata, {
        position: [arr.lon, arr.lat],
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
    if (
      !dep.iata ||
      !arr.iata ||
      dep.lon == null ||
      dep.lat == null ||
      arr.lon == null ||
      arr.lat == null
    )
      continue;

    const key = routeKey(dep.iata, arr.iata);
    const count = routeCounts.get(key) ?? 0;
    if (count < minRouteCount || arcMap.has(key)) continue;

    const color = getHeatmapColor(count, q25, q50, q75);
    arcMap.set(key, {
      sourcePosition: [dep.lon, dep.lat],
      targetPosition: [arr.lon, arr.lat],
      count,
      sourceColor: [...color, 200] as [number, number, number, number],
      targetColor: [...color, 200] as [number, number, number, number],
    });
  }

  return { arcs: [...arcMap.values()], points: [...airportMap.values()] };
}

export function createRoutesLayers(
  flights: GeoJSONFeature[],
  minRouteCount: number
): [ArcLayer<ArcDatum>, ScatterplotLayer<PointDatum>] {
  const { arcs, points } = buildRouteData(flights, minRouteCount);

  const arcLayer = new ArcLayer<ArcDatum>({
    id: "routes-arc",
    data: arcs,
    getSourcePosition: (d) => d.sourcePosition,
    getTargetPosition: (d) => d.targetPosition,
    getSourceColor: (d) => d.sourceColor,
    getTargetColor: (d) => d.targetColor,
    getWidth: 2,
    pickable: true,
  });

  const scatterLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-scatter",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(4 + d.count * 0.5, 12) * 1000,
    getFillColor: [100, 180, 255, 200],
    pickable: true,
  });

  return [arcLayer, scatterLayer];
}

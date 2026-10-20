import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import { computeSchematicRoute } from "../schematicRouter";

export interface FerryEnds {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

export function sameFerryEnds(a: FerryEnds, b: FerryEnds): boolean {
  return (
    a.depLat === b.depLat && a.depLon === b.depLon && a.arrLat === b.arrLat && a.arrLon === b.arrLon
  );
}

/** A computed sea route is an estimate, never an observed ship track. */
export async function computeFerryGeometry(ends: FerryEnds) {
  const from = { lat: ends.depLat, lon: ends.depLon };
  const to = { lat: ends.arrLat, lon: ends.arrLon };
  const route = await computeSchematicRoute(from, to);
  const line = route.waypoints;
  if (
    !route.routed ||
    line.length < 3 ||
    !line.every(
      (p) =>
        p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
    )
  )
    return null;
  const coords = line.map(([lon, lat]) => ({ lat, lon }));
  if (haversineKm(from, coords[0]) > 1 || haversineKm(to, coords[coords.length - 1]) > 1)
    return null;
  const km = polylineLengthKm(coords);
  const chord = haversineKm(from, to);
  if (!Number.isFinite(km) || km <= 0 || km < chord * 0.99 || (chord > 0.5 && km > chord * 20))
    return null;
  return { geometry: line, distanceKm: Math.round(km * 10) / 10 };
}

export function readSeaGeometry(value: unknown): Array<[number, number]> | null {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    !value.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90
    )
  )
    return null;
  return value as Array<[number, number]>;
}

import { haversineKm } from "../../shared/geo/haversine";
import { polylineDistanceKm } from "../cruiseDistance/polylineDistance";

/**
 * How long a leg is, and which of those kilometres a vehicle actually rolled.
 *
 * Deliberately pure: the same rules have to hold for a leg being previewed
 * in the editor and one being persisted by the assignment endpoint.
 */

export const LEG_MODES = ["road", "ferry", "rail", "foot", "bike"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export const LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;
export type LegSource = (typeof LEG_SOURCES)[number];

/**
 * Modes a vehicle's odometer sees. Ferry and rail carry the vehicle or the
 * traveller; foot and bike are self-powered. Keeping this a allow-list
 * rather than a deny-list means a mode added later is excluded until
 * someone decides otherwise — the safe direction for a mileage figure.
 */
const DRIVEN_MODES: ReadonlySet<string> = new Set<string>(["road"]);

export interface Coord {
  lat: number;
  lon: number;
}

export interface LegDistanceInput {
  source: LegSource;
  from: Coord;
  to: Coord;
  /** `[[lon, lat], …]` in GeoJSON order, as stored. */
  waypoints?: Array<[number, number]> | null;
}

const finite = (n: number): boolean => Number.isFinite(n);

export function legDistanceKm(input: LegDistanceInput): number {
  if (!finite(input.from.lat) || !finite(input.from.lon) ||
      !finite(input.to.lat) || !finite(input.to.lon)) {
    throw new Error("legDistanceKm: leg endpoint has a non-finite coordinate");
  }
  const chord = haversineKm(input.from, input.to);
  if (input.source === "straight") return chord;

  const line = input.waypoints;
  if (!line || line.length < 2) return chord;
  for (const [lon, lat] of line) {
    if (!finite(lon) || !finite(lat)) {
      throw new Error("legDistanceKm: waypoint has a non-finite coordinate");
    }
  }
  const measured = polylineDistanceKm(line);
  // A line can have two or more points and still be zero-length — a drag
  // that snapped back to its start. That is a missing route, not a short
  // one, so it falls back to the chord exactly like a too-short line.
  return measured > 0 ? measured : chord;
}

export function drivenKm(legs: readonly { mode: string; distanceKm: number }[]): number {
  return legs.reduce((sum, l) => (DRIVEN_MODES.has(l.mode) ? sum + l.distanceKm : sum), 0);
}

export function travelledKm(legs: readonly { distanceKm: number }[]): number {
  return legs.reduce((sum, l) => sum + l.distanceKm, 0);
}

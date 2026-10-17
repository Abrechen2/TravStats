import { calculateDistance } from "../../lib/geo";

export interface AirportPosition {
  lat: number;
  lon: number;
}

export interface FlownVsGreatCircle {
  greatCircleKm: number;
  /** Signed, rounded: +7 = the recording is 7 % longer than the great circle. */
  differencePercent: number;
}

/** Below this the two ends are one airfield — a sightseeing loop has no great circle. */
const MIN_GREAT_CIRCLE_KM = 1;

/** `0,0` is how an unknown position is stored, never an airport (Gulf of Guinea). */
function known(p: AirportPosition | null | undefined): p is AirportPosition {
  return (
    p !== null &&
    p !== undefined &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    !(p.lat === 0 && p.lon === 0)
  );
}

/**
 * The recorded distance set against the great circle between the two
 * airports (forgejo#312). Null — not a comparison against zero — when an end
 * has no position or both ends are the same field.
 */
export function flownVsGreatCircle(
  flownKm: number,
  departure: AirportPosition | null | undefined,
  arrival: AirportPosition | null | undefined
): FlownVsGreatCircle | null {
  if (!known(departure) || !known(arrival)) return null;
  const greatCircleKm = calculateDistance(departure.lat, departure.lon, arrival.lat, arrival.lon);
  if (greatCircleKm < MIN_GREAT_CIRCLE_KM) return null;
  return {
    greatCircleKm,
    differencePercent: Math.round(((flownKm - greatCircleKm) / greatCircleKm) * 100),
  };
}

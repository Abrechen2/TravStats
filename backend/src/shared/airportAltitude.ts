/**
 * `Airport.altitude` is METRES above sea level (forgejo#256). Every source this
 * app reads publishes FEET — OurAirports' `elevation_ft`, OpenFlights' altitude
 * column — so every writer converts through this one function, and the
 * "highest airport" figure prints metres.
 *
 * Two legacy writers (`scripts/importAirports.ts`, `seedAirports.ts`) stored
 * the feet unconverted. Neither is wired into a package script or the image,
 * and production was checked read-only on 2026-10-10: Frankfurt 111, Munich
 * 453, La Paz 4071, Denver 1655 — metres — and the single value above 4500 is
 * Fausa (SPFA, Peru), 4514 m = 14 810 ft, correct. No data migration.
 */
const METRES_PER_FOOT = 0.3048;

/** Feet → whole metres; null for a missing or unparseable value (never 0). */
export function altitudeMetresFromFeet(feet: number | string | null | undefined): number | null {
  if (feet === null || feet === undefined || feet === "" || feet === "\\N") return null;
  const value = typeof feet === "number" ? feet : parseFloat(feet);
  return Number.isFinite(value) ? Math.round(value * METRES_PER_FOOT) : null;
}

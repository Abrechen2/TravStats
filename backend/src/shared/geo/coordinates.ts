/**
 * What counts as a usable pair of coordinates.
 *
 * Every geocoder here checked `Number.isFinite` and stopped. That misses two
 * things, and both reached the database (AUD-071):
 *
 *  - `Number(null)` is 0 and `Number("")` is 0, so a provider row with a
 *    missing latitude parsed as a perfectly finite zero;
 *  - no bounds at all, so a latitude of 1000 was accepted as a position.
 *
 * The result was a hotel stored at 0/0 and reported as successfully located.
 */

/** Latitude and longitude are only meaningful inside these. */
export const LAT_RANGE = { min: -90, max: 90 } as const;
export const LON_RANGE = { min: -180, max: 180 } as const;

/**
 * Parse a coordinate that arrived as a string or a number.
 *
 * Returns null for anything that is not a real numeric value — including
 * `null`, `undefined` and the empty string, which `Number()` silently turns
 * into 0. That coercion is the bug this exists to prevent, so it is refused
 * here rather than being checked for afterwards.
 */
export function parseCoordinate(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Is this a position a record could plausibly hold?
 *
 * Exact 0/0 is refused. It is a real point in the Gulf of Guinea and nothing
 * in this application is ever there — a hotel, an airport, a place — so in
 * practice it is always the residue of a failed parse. Treating it as a
 * successful geocode is what put pins in the Atlantic.
 */
export function isPlausibleCoordinate(lat: unknown, lon: unknown): boolean {
  const parsedLat = parseCoordinate(lat);
  const parsedLon = parseCoordinate(lon);
  if (parsedLat === null || parsedLon === null) return false;
  if (parsedLat < LAT_RANGE.min || parsedLat > LAT_RANGE.max) return false;
  if (parsedLon < LON_RANGE.min || parsedLon > LON_RANGE.max) return false;
  return !(parsedLat === 0 && parsedLon === 0);
}

/** The pair, or null when it is not usable. Convenience over the two above. */
export function toCoordinates(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (!isPlausibleCoordinate(lat, lon)) return null;
  return { lat: parseCoordinate(lat) as number, lon: parseCoordinate(lon) as number };
}

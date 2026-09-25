/**
 * Which hemisphere a coordinate is in, read off the coordinate.
 *
 * "Southernmost" names a rank within the account, not a side of the equator.
 * The statistics card took the two for the same thing: it printed
 * `{{lat}}°S` with `Math.abs(lat)`, so a purely northern logbook labelled
 * Bangkok — stored at +13.68 — as "13.68°S" (audit 2026-09-20,
 * SRV-STATS-HEMISPHERE-001). The northernmost card had the mirror defect and
 * printed the raw signed value, so a purely southern logbook read "-33.95°N".
 *
 * Three screens had already written the correct one-liner by hand and a
 * fourth wrote it wrong, which is the argument for one home.
 */

export type LatitudeHemisphere = "N" | "S";
export type LongitudeHemisphere = "E" | "W";

/** The equator counts as north, as the convention everywhere else here does. */
export function latitudeHemisphere(lat: number): LatitudeHemisphere {
  return lat >= 0 ? "N" : "S";
}

/** The prime meridian counts as east, for the same reason. */
export function longitudeHemisphere(lon: number): LongitudeHemisphere {
  return lon >= 0 ? "E" : "W";
}

/** "52.52° N" — the letter reads faster than a minus sign. */
export function formatLatitude(lat: number, fractionDigits = 2): string {
  return `${Math.abs(lat).toFixed(fractionDigits)}° ${latitudeHemisphere(lat)}`;
}

export function formatLongitude(lon: number, fractionDigits = 2): string {
  return `${Math.abs(lon).toFixed(fractionDigits)}° ${longitudeHemisphere(lon)}`;
}

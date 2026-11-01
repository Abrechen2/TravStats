/**
 * The flight form's time-estimate history (forgejo#407, H15). It lives in
 * localStorage as the estimator's working copy and follows the account through
 * the `flightTimeHistory` web-prefs section: a device that has entries and finds
 * none on the server seeds the account with them once (the migration of the old
 * browser-only value), a device that finds the server's copy takes it.
 */

export const HISTORICAL_FLIGHT_TIMES_KEY = "travstats_historical_flight_times";

/**
 * Newest entries kept. About 170 bytes each, against the server's 16 KB bound
 * for one section: 60 leaves headroom for long flight numbers.
 */
export const MAX_HISTORICAL_FLIGHT_TIMES = 60;

/** Entries of a stored value that look like a sample, newest `MAX` of them. */
export function sanitizeHistory(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const ok = value.filter((e): e is Record<string, unknown> => {
    if (typeof e !== "object" || e === null) return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.flightNumber === "string" &&
      typeof r.departureIata === "string" &&
      typeof r.arrivalIata === "string" &&
      typeof r.boardingTime === "string" &&
      typeof r.departureTime === "string" &&
      typeof r.arrivalTime === "string" &&
      typeof r.date === "string"
    );
  });
  return ok.slice(-MAX_HISTORICAL_FLIGHT_TIMES);
}

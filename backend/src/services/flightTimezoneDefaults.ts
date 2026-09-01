/**
 * Fill in a missing timezone from the airport the caller already named.
 *
 * A local wall-clock time is meaningless without a zone, so the schema refuses
 * `departureLocal` unless `depTimezone` comes with it. That rule is right, but
 * it used to fire even when the caller had said `departure.iata` — and the
 * airport catalogue holds that airport's zone. Someone importing an old mailbox
 * got a validation error on every request for a value the server had on file
 * (#286).
 *
 * This runs BEFORE validation, on the raw body, because the schema check is
 * synchronous and cannot reach the database. What it does not do is override:
 * a timezone the caller stated wins, always. A caller may legitimately know
 * better than the catalogue — a historical flight from an airport that has
 * since changed zone, say — and silently replacing their value would be the
 * server overruling a fact it was told.
 *
 * When no airport can answer, nothing is filled in and the schema still
 * refuses. That is the case the rule exists for.
 */

import { getCachedAirports } from "./airportCache";

/** The `{ iata, icao }` shape both `departure` and `arrival` arrive in. */
interface EndpointLike {
  iata?: unknown;
  icao?: unknown;
}

const codeOf = (end: unknown, key: "iata" | "icao"): string | null => {
  if (typeof end !== "object" || end === null) return null;
  const value = (end as EndpointLike)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const hasLocal = (body: Record<string, unknown>, field: string): boolean =>
  typeof body[field] === "string" && (body[field] as string).length > 0;

const missingTz = (body: Record<string, unknown>, field: string): boolean => {
  const value = body[field];
  return value === undefined || value === null || value === "";
};

/**
 * Each local/timezone pair, and which end of the flight answers for it.
 *
 * The actual times pair with the same ends as the scheduled ones: an actual
 * departure happens at the departure airport.
 */
const PAIRS: Array<{ local: string; tz: string; end: "departure" | "arrival" }> = [
  { local: "departureLocal", tz: "depTimezone", end: "departure" },
  { local: "arrivalLocal", tz: "arrTimezone", end: "arrival" },
  { local: "actualDepartureLocal", tz: "actualDepartureTz", end: "departure" },
  { local: "actualArrivalLocal", tz: "actualArrivalTz", end: "arrival" },
];

/**
 * Returns a NEW body with any answerable timezone filled in. The input is not
 * modified — callers pass `req.body`, which nothing downstream should find
 * rewritten under it.
 */
export async function withAirportTimezones<T>(rawBody: T): Promise<T> {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return rawBody;
  }
  const body = rawBody as Record<string, unknown>;

  const wanted = PAIRS.filter((p) => hasLocal(body, p.local) && missingTz(body, p.tz));
  if (wanted.length === 0) return rawBody;

  const codes = new Set<string>();
  for (const { end } of wanted) {
    for (const key of ["iata", "icao"] as const) {
      const code = codeOf(body[end], key);
      if (code) codes.add(code);
    }
  }
  if (codes.size === 0) return rawBody;

  let zones = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(codes));
    zones = new Map(
      [...airports.entries()]
        .filter(([, data]) => Boolean(data?.timezone))
        .map(([code, data]) => [code, data.timezone as string]),
    );
  } catch {
    // Catalogue unreachable: fill nothing in, and let the schema say what is
    // missing. Guessing a zone would be worse than the error.
    return rawBody;
  }

  const filled: Record<string, unknown> = { ...body };
  for (const { tz, end } of wanted) {
    const zone =
      zones.get(codeOf(body[end], "iata") ?? "") ?? zones.get(codeOf(body[end], "icao") ?? "");
    if (zone) filled[tz] = zone;
  }
  return filled as T;
}

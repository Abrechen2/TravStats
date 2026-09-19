import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDistinctEvidence, flightSumEvidence, requireAllTime } from "./flightMeasureResponse";
import {
  loadCountableCodeRows,
  loadCountableCoordinateRows,
  loadClockedFlightRows,
  type FlightCodeRow,
} from "./flightPopulations";
import {
  buildAirportTimezoneMap,
  continentsTouchedBy,
  countRoundTrips,
  crossesDateLine,
  crossesHemisphere,
  crossesLocalMidnight,
  flightAirportCodes,
  flightCountryReach,
  isArcticFlight,
  isOceanCrossing,
  isSameLocalDayFlight,
  isTimeTravelFlight,
  longitudeDirectionOf,
  touchesTropics,
  type FlightCountryReach,
} from "../../utils/stats/flightPredicates";
import { getCachedAirports } from "../airportCache";
import type { AirportData } from "../airportLookup";

/**
 * `metric` evidence for the fifteen served tiles of `StatsUniqueSection`
 * (`GET /stats/unique`, `utils/stats/uniqueStats.ts`).
 *
 * Every per-flight rule comes from `utils/stats/flightPredicates.ts`, which
 * `calculateUniqueStats` itself calls. Three inherited quirks a reader will
 * otherwise mistake for bugs here:
 *
 *   - `equatorCrossingCount` and `hemisphereHopCount` are the SAME predicate
 *     and therefore always the same number. That is the tile's own state,
 *     not a copy-paste in this file.
 *   - the time-travel rule skips a flight whose zones cannot both be
 *     resolved, while the same-day and midnight rules fall back to UTC. The
 *     calculators differ that way and the panels follow them.
 *   - `roundTripFlightCount` counts PAIRS, not flights — see its own note.
 *
 * The remaining twelve tiles on that surface are `extremum`, `ratio`,
 * `boolean` or `sequence` measures and wait for release 2.
 */

async function airportCatalogueFor(rows: FlightCodeRow[]): Promise<Map<string, AirportData>> {
  return getCachedAirports(flightAirportCodes(rows));
}

// ── Geography, over the countable set ────────────────────────────────────

export async function resolveEquatorCrossingCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "equatorCrossingCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "equatorCrossingCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(crossesHemisphere),
  });
}

export async function resolveHemisphereHopCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "hemisphereHopCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "hemisphereHopCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(crossesHemisphere),
  });
}

export async function resolveArcticFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "arcticFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "arcticFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(isArcticFlight),
  });
}

export async function resolveOceanCrossingCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "oceanCrossingCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "oceanCrossingCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(isOceanCrossing),
  });
}

export async function resolveDateLineCrossingCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "dateLineCrossingCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "dateLineCrossingCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(crossesDateLine),
  });
}

export async function resolveTropicsFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "tropicsFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "tropicsFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(touchesTropics),
  });
}

export async function resolveEastwardFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "eastwardFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "eastwardFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => longitudeDirectionOf(row) === "east"),
  });
}

export async function resolveWestwardFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "westwardFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "westwardFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => longitudeDirectionOf(row) === "west"),
  });
}

// ── The airport catalogue, over the countable set ────────────────────────

/**
 * `continentsTouchedByFlightCount` is `distinct`: the units are continents,
 * and a flight credits each continent its two ends resolve to, deduplicated
 * against each other — a domestic flight proves ONE continent, not two.
 *
 * A flight whose airports the catalogue cannot place credits nothing and
 * stays in the list with an empty `credits` array, rather than being counted
 * into `unattributed`. The brief asked for the latter; the distinct
 * invariant forbids it, and the invariant is right: `unattributed` counts
 * UNITS of the value that no row can name (`assertDistinctInvariant` adds it
 * to the credited union to reach `value`), so putting ROWS there would
 * inflate the expected total by the number of unplaceable flights. The same
 * shape `resolveAirlineCount` and `resolveContinentsVisitedCount` already
 * use.
 */
export async function resolveContinentsTouchedByFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "continentsTouchedByFlightCount");
  const rows = await loadCountableCodeRows(userId);
  const airports = await airportCatalogueFor(rows);
  return flightDistinctEvidence({
    userId,
    key: "continentsTouchedByFlightCount",
    unit: "continents",
    scope,
    page,
    rows,
    creditsOf: (row) => continentsTouchedBy(row, airports),
  });
}

async function resolveCountryReachCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams,
  key: "internationalFlightCount" | "domesticFlightCount",
  reach: FlightCountryReach
): Promise<EvidenceResponse> {
  requireAllTime(scope, key);
  const rows = await loadCountableCodeRows(userId);
  const airports = await airportCatalogueFor(rows);
  return flightSumEvidence({
    userId,
    key,
    unit: "flights",
    scope,
    page,
    // A flight whose two countries are not BOTH known is in neither count —
    // `flightCountryReach` answers null for it, and null matches neither
    // side. The two counts therefore need not add up to the flight total,
    // which is the calculator's own behaviour and not a gap here.
    rows: rows.filter((row) => flightCountryReach(row, airports) === reach),
  });
}

export function resolveInternationalFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return resolveCountryReachCount(userId, scope, page, "internationalFlightCount", "international");
}

export function resolveDomesticFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return resolveCountryReachCount(userId, scope, page, "domesticFlightCount", "domestic");
}

/**
 * `roundTripFlightCount` counts complete A→B→A pairs, so its unit is round
 * trips and TWO rows produce each one. Each paired leg therefore contributes
 * 0.5: the panel's rows add up to the tile's number, and the list says which
 * legs those were — with three outbound legs against one return, exactly one
 * outbound made the round trip and `countRoundTrips` names it (earliest
 * first, deterministically).
 *
 * Only the paired legs are listed. Listing all three outbounds at a third of
 * a round trip each would be arithmetically fine and factually wrong: two of
 * them are not part of any round trip at all.
 */
export async function resolveRoundTripFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "roundTripFlightCount");
  const rows = await loadCountableCodeRows(userId);
  const { pairedLegIds } = countRoundTrips(rows);
  const paired = new Set(pairedLegIds);
  return flightSumEvidence({
    userId,
    key: "roundTripFlightCount",
    unit: "roundTrips",
    scope,
    page,
    rows: rows.filter((row) => paired.has(row.id)),
    contributionOf: () => 0.5,
    // Two legs per round trip means the total is always a whole number, but
    // a PAGE of the evidence may end between the two halves of one — which
    // is exactly why the rounding belongs to the total and not to a row.
    round: (total) => total,
  });
}

// ── The local clock, over the flown-with-both-times subset ───────────────

export async function resolveTimeTravelFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "timeTravelFlightCount");
  const rows = await loadClockedFlightRows(userId);
  const timezoneByCode = await buildAirportTimezoneMap(rows, "evidence_time_travel");
  return flightSumEvidence({
    userId,
    key: "timeTravelFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => isTimeTravelFlight(row, timezoneByCode)),
  });
}

export async function resolveSameDayFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "sameDayFlightCount");
  const rows = await loadClockedFlightRows(userId);
  const timezoneByCode = await buildAirportTimezoneMap(rows, "evidence_same_day");
  return flightSumEvidence({
    userId,
    key: "sameDayFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => isSameLocalDayFlight(row, timezoneByCode)),
  });
}

export async function resolveMidnightFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "midnightFlightCount");
  const rows = await loadClockedFlightRows(userId);
  const timezoneByCode = await buildAirportTimezoneMap(rows, "evidence_midnight");
  return flightSumEvidence({
    userId,
    key: "midnightFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => crossesLocalMidnight(row, timezoneByCode)),
  });
}

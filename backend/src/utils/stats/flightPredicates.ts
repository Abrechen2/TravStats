import { calculateDistance } from "../geo";
import { getCachedAirports } from "../../services/airportCache";
import logger from "../logger";
import { departureClockOf } from "./departureClock";
import { toLocalDateString, type FlightTimeSemantics } from "../timezone";
import { getContinent, type Continent } from "../continents";
import type { AirportData } from "../../services/airportLookup";

/**
 * The per-flight rules behind `/stats/fun` and `/stats/unique`, in one home.
 *
 * They were inline in `funStats.ts` and `uniqueStats.ts` — the only two
 * readers — until the evidence panel needed a SECOND reader for each: the
 * panel has to list the very flights a tile counted, so it must apply the
 * calculator's own predicate, not a predicate that resembles it. A copy in
 * the resolver would drift the day the calculator changed, and the drift
 * would be invisible: the tile and the panel would simply disagree, which is
 * the defect the panel exists to make impossible. This is the same move
 * `shared/lodgingCounting.ts` and `utils/continents.ts` already made for
 * their own questions ("a counting rule has exactly one home").
 *
 * Two facts a reader needs, both measured rather than assumed:
 *
 *   - `dep_lat`/`dep_lon`/`arr_lat`/`arr_lon` are `Float` NOT NULL in
 *     `schema.prisma`, so the null branches below cannot fire for a row read
 *     from the flight table. They are kept because `FlightData` declares the
 *     fields nullable for hand-built callers, and because the calculators
 *     they came from guarded them.
 *   - Two of these predicates are the SAME rule under two names:
 *     `/stats/unique` counts "equator crossings" and "hemisphere hops" with
 *     byte-identical code, so the two tiles have always shown the same
 *     number. `crossesHemisphere` is that one rule; whether the product
 *     wants two tiles for it is a product question, and answering it here
 *     under cover of a refactor would move a figure on screen.
 */

export interface FlightCoordinates {
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
}

export interface FlightEndpoints {
  depIata?: string | null;
  depIcao?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
}

/** Departure-clock inputs — `departureClockOf`'s own three fields, nothing more. */
export interface FlightDepartureClock {
  departureTime: Date | null;
  depTimezone?: string | null;
  depTimeSemantics?: FlightTimeSemantics;
}

/** An endpoint's code as every one of these rules resolves it: IATA first, ICAO as the fallback. */
export function departureEndpointCode(flight: FlightEndpoints): string | null {
  return flight.depIata || flight.depIcao || null;
}

export function arrivalEndpointCode(flight: FlightEndpoints): string | null {
  return flight.arrIata || flight.arrIcao || null;
}

// ── Distance bands ───────────────────────────────────────────────────────

/** "Short haul king" — under this many kilometres. */
export const SHORT_HAUL_MAX_KM = 500;
/** "Long haul pilot" — at or above this many kilometres. */
export const LONG_HAUL_MIN_KM = 5000;
/**
 * "Ocean crossing" — ABOVE this many kilometres. Deliberately strict where
 * long haul is inclusive: `/stats/unique` uses `> 5000` and `/stats/fun`
 * uses `>= 5000`, so a flight of exactly 5000 km is long haul and is not an
 * ocean crossing. Unifying the two comparisons would change a number on
 * screen, which is a product decision and not a refactor's to make.
 */
export const OCEAN_CROSSING_MIN_KM = 5000;

/** Great-circle kilometres, or null when an endpoint has no coordinates. */
export function flightDistanceKm(flight: FlightCoordinates): number | null {
  const { depLat, depLon, arrLat, arrLon } = flight;
  if (depLat == null || depLon == null || arrLat == null || arrLon == null) return null;
  return calculateDistance(depLat, depLon, arrLat, arrLon);
}

export function isShortHaulFlight(flight: FlightCoordinates): boolean {
  const distance = flightDistanceKm(flight);
  return distance !== null && distance < SHORT_HAUL_MAX_KM;
}

export function isLongHaulFlight(flight: FlightCoordinates): boolean {
  const distance = flightDistanceKm(flight);
  return distance !== null && distance >= LONG_HAUL_MIN_KM;
}

export function isOceanCrossing(flight: FlightCoordinates): boolean {
  const distance = flightDistanceKm(flight);
  return distance !== null && distance > OCEAN_CROSSING_MIN_KM;
}

// ── Latitude and longitude bands ─────────────────────────────────────────

export const ARCTIC_CIRCLE_LAT = 66.5;
export const TROPIC_LAT = 23.5;

/**
 * North↔south crossing. Backs BOTH `equatorCrossings` and `hemisphereHops`
 * in `/stats/unique` — see the module header on why they stay two tiles.
 * A latitude of exactly 0 counts as neither hemisphere, as it always has.
 */
export function crossesHemisphere(flight: FlightCoordinates): boolean {
  const { depLat, arrLat } = flight;
  if (depLat == null || arrLat == null) return false;
  return (depLat > 0 && arrLat < 0) || (depLat < 0 && arrLat > 0);
}

/** Either END north of the Arctic circle — the flight need not cross it. */
export function isArcticFlight(flight: FlightCoordinates): boolean {
  const { depLat, arrLat } = flight;
  return (
    (depLat != null && depLat >= ARCTIC_CIRCLE_LAT) ||
    (arrLat != null && arrLat >= ARCTIC_CIRCLE_LAT)
  );
}

/**
 * Longitudes more than 180° apart — the flight took the short way round,
 * across the date line. A heuristic on the stored endpoints, not a path.
 */
export function crossesDateLine(flight: FlightCoordinates): boolean {
  const { depLon, arrLon } = flight;
  if (depLon == null || arrLon == null) return false;
  return Math.abs(arrLon - depLon) > 180;
}

/** Either end inside the tropics — but BOTH latitudes must be known first. */
export function touchesTropics(flight: FlightCoordinates): boolean {
  const { depLat, arrLat } = flight;
  if (depLat == null || arrLat == null) return false;
  const depInTropics = depLat >= -TROPIC_LAT && depLat <= TROPIC_LAT;
  const arrInTropics = arrLat >= -TROPIC_LAT && arrLat <= TROPIC_LAT;
  return depInTropics || arrInTropics;
}

export type LongitudeDirection = "east" | "west";

/**
 * Which way round the globe the flight went, date line folded out. `null`
 * for a flight with no longitude change at all — that is neither eastward
 * nor westward, and `/stats/unique` counts it in neither tally.
 */
export function longitudeDirectionOf(flight: FlightCoordinates): LongitudeDirection | null {
  const { depLon, arrLon } = flight;
  if (depLon == null || arrLon == null) return null;
  let lonDiff = arrLon - depLon;
  if (lonDiff > 180) lonDiff -= 360;
  if (lonDiff < -180) lonDiff += 360;
  if (lonDiff > 0) return "east";
  if (lonDiff < 0) return "west";
  return null;
}

// ── The departure clock ──────────────────────────────────────────────────

export type DepartureDaypart = "morning" | "afternoon" | "evening";

/**
 * Time-of-day bucket on the DEPARTURE airport's clock (#266), or null when
 * the row has no trustworthy hour — a `DATE_ONLY` row carries a 12:00
 * placeholder and `localWallClockOf` reports `hour: null` for it, so it is
 * left out entirely rather than counted as an afternoon flight.
 */
export function departureDaypartOf(flight: FlightDepartureClock): DepartureDaypart | null {
  const hour = departureClockOf(flight)?.hour ?? null;
  if (hour === null) return null;
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** Saturday or Sunday on the departure airport's clock. */
export function isWeekendDeparture(flight: FlightDepartureClock): boolean {
  const weekday = departureClockOf(flight)?.weekday;
  return weekday === 0 || weekday === 6;
}

// ── The airport timezone map, and the three rules that read it ───────────

/** Every airport code a set of flights names, both IATA and ICAO, both ends. */
export function flightAirportCodes(flights: FlightEndpoints[]): string[] {
  const codes = new Set<string>();
  for (const flight of flights) {
    if (flight.depIata) codes.add(flight.depIata);
    if (flight.depIcao) codes.add(flight.depIcao);
    if (flight.arrIata) codes.add(flight.arrIata);
    if (flight.arrIcao) codes.add(flight.arrIcao);
  }
  return [...codes];
}

/**
 * code → IANA timezone, for every endpoint of these flights.
 *
 * Returns an EMPTY map when the airport catalogue cannot be read, which is
 * what both calculators do: they log and carry on with whatever they have,
 * so a catalogue outage costs a timezone-dependent figure rather than the
 * whole endpoint. `operation` rides into the log line so the failure still
 * names which figure went short.
 */
export async function buildAirportTimezoneMap(
  flights: FlightEndpoints[],
  operation: string
): Promise<Map<string, string>> {
  const timezoneByCode = new Map<string, string>();
  try {
    const airports = await getCachedAirports(flightAirportCodes(flights));
    for (const [code, airport] of airports.entries()) {
      if (airport?.timezone) timezoneByCode.set(code, airport.timezone);
    }
  } catch (error) {
    logger.error({
      operation,
      message: "Failed to fetch airports for timezone calculation",
      error,
    });
  }
  return timezoneByCode;
}

export function departureTimezoneOf(
  flight: FlightEndpoints,
  timezoneByCode: Map<string, string>
): string | null {
  return (
    (flight.depIata && timezoneByCode.get(flight.depIata)) ||
    (flight.depIcao && timezoneByCode.get(flight.depIcao)) ||
    null
  );
}

export function arrivalTimezoneOf(
  flight: FlightEndpoints,
  timezoneByCode: Map<string, string>
): string | null {
  return (
    (flight.arrIata && timezoneByCode.get(flight.arrIata)) ||
    (flight.arrIcao && timezoneByCode.get(flight.arrIcao)) ||
    null
  );
}

/** A flight with both clocks on file — the `flown` subset these three rules read. */
export interface FlightLocalTimes extends FlightEndpoints {
  departureTime: Date;
  arrivalTime: Date;
}

/**
 * The clock appeared to go backwards: local arrival earlier in the day than
 * local departure. A flight whose zones cannot BOTH be resolved is skipped
 * rather than guessed — unlike the same-day and midnight rules below, which
 * fall back to UTC through `toLocalDateString`. That difference is the
 * calculators' own and is preserved deliberately: a time-travel claim on a
 * guessed zone would be a fabricated curiosity, while a date comparison on
 * two UTC readings is at least self-consistent.
 */
export function isTimeTravelFlight(
  flight: FlightLocalTimes,
  timezoneByCode: Map<string, string>
): boolean {
  const depTz = departureTimezoneOf(flight, timezoneByCode);
  const arrTz = arrivalTimezoneOf(flight, timezoneByCode);
  if (!depTz || !arrTz) return false;
  return toLocalMinutes(flight.arrivalTime, arrTz) < toLocalMinutes(flight.departureTime, depTz);
}

/** Departs and arrives on the same local calendar day. */
export function isSameLocalDayFlight(
  flight: FlightLocalTimes,
  timezoneByCode: Map<string, string>
): boolean {
  const [depDate, arrDate] = localEndpointDates(flight, timezoneByCode);
  return depDate === arrDate;
}

/** Crosses local midnight — the exact complement of `isSameLocalDayFlight`. */
export function crossesLocalMidnight(
  flight: FlightLocalTimes,
  timezoneByCode: Map<string, string>
): boolean {
  const [depDate, arrDate] = localEndpointDates(flight, timezoneByCode);
  return depDate !== arrDate;
}

function localEndpointDates(
  flight: FlightLocalTimes,
  timezoneByCode: Map<string, string>
): [string, string] {
  return [
    toLocalDateString(flight.departureTime, departureTimezoneOf(flight, timezoneByCode)),
    toLocalDateString(flight.arrivalTime, arrivalTimezoneOf(flight, timezoneByCode)),
  ];
}

/**
 * Minutes since local midnight in the given IANA zone. Falls back to UTC on
 * an unrecognised zone string rather than throwing — the caller has already
 * decided the zone is worth reading.
 */
function toLocalMinutes(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(date);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return h * 60 + m;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

// ── Round trips ──────────────────────────────────────────────────────────

export interface RoundTripLeg extends FlightEndpoints {
  id: string;
  departureTime: Date | null;
}

export interface RoundTripCount {
  /** Complete A→B→A pairs. NOT a flight count — each one consumes two legs. */
  total: number;
  /** The legs those pairs are made of, two per round trip, earliest first. */
  pairedLegIds: string[];
}

/**
 * Complete round trips over a set of legs.
 *
 * A direction pair yields as many round trips as its THINNER side —
 * `min(there, back)`. The count this replaced added up every leg with any
 * counterpart and halved the sum, so three A→B against one B→A reported two
 * round trips where only one exists.
 *
 * `pairedLegIds` is what the evidence panel lists, and it is why this
 * returns a shape rather than a number: with three A→B legs against one B→A,
 * ONE of the three is part of the round trip and the other two are not, so
 * the panel has to be told which. The choice is earliest-first (departure
 * date ascending, id as the tie-breaker) — any deterministic rule would
 * satisfy the arithmetic, and a non-deterministic one would let two opens of
 * the same panel name different flights.
 */
export function countRoundTrips(legs: RoundTripLeg[]): RoundTripCount {
  interface Direction {
    dep: string;
    arr: string;
    legIds: string[];
  }
  const byDirection = new Map<string, Direction>();
  const ordered = [...legs].sort(compareLegChronologically);

  for (const leg of ordered) {
    const dep = departureEndpointCode(leg);
    const arr = arrivalEndpointCode(leg);
    if (!dep || !arr) continue;
    // A leg that returns to the airport it left — a sightseeing or training
    // flight — is NOT a round trip: there is no "back", because it never went
    // anywhere. It used to count as n of them, and wrongly: such a leg's
    // direction key IS its own reverse key, so `back` was the same bucket as
    // `direction` and `min(n, n)` was `n`. Worse for the evidence panel,
    // `pairedLegIds` then received every one of those ids TWICE, and the
    // resolver de-duplicates — so the tile said n while the panel proved
    // n/2, over the very rows it was listing.
    if (dep === arr) continue;
    const key = `${dep} ${arr}`;
    const direction = byDirection.get(key) ?? { dep, arr, legIds: [] };
    direction.legIds.push(leg.id);
    byDirection.set(key, direction);
  }

  const counted = new Set<string>();
  let total = 0;
  const pairedLegIds: string[] = [];
  for (const [key, direction] of byDirection.entries()) {
    const reverseKey = `${direction.arr} ${direction.dep}`;
    const back = byDirection.get(reverseKey);
    if (!back) continue;
    // Each unordered pair once — otherwise A→B and B→A both add the same
    // round trips.
    const pairKey = [key, reverseKey].sort().join("|");
    if (counted.has(pairKey)) continue;
    counted.add(pairKey);
    const pairs = Math.min(direction.legIds.length, back.legIds.length);
    total += pairs;
    pairedLegIds.push(...direction.legIds.slice(0, pairs), ...back.legIds.slice(0, pairs));
  }
  return { total, pairedLegIds };
}

/** Undated legs last, so a missing date never silently sorts as 1970. */
function compareLegChronologically(a: RoundTripLeg, b: RoundTripLeg): number {
  if (a.departureTime && b.departureTime) {
    const diff = a.departureTime.getTime() - b.departureTime.getTime();
    if (diff !== 0) return diff;
  } else if (a.departureTime) {
    return -1;
  } else if (b.departureTime) {
    return 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ── Rules that need the airport catalogue ────────────────────────────────

/**
 * The continents a flight touched, deduplicated across its own two ends.
 *
 * An airport the catalogue does not know, or one `getContinent` cannot
 * place, credits nothing — `utils/continents.ts` returns null rather than
 * guessing, and this rule inherits that abstention rather than inventing an
 * "Other" bucket. (`calculateAirportStats` DOES keep an "Other" key for its
 * own continent count and then filters it out again; the two counts have
 * always differed in wording and agreed in number.)
 */
export function continentsTouchedBy(
  flight: FlightEndpoints,
  airports: Map<string, AirportData>
): Continent[] {
  const touched = new Set<Continent>();
  for (const code of [departureEndpointCode(flight), arrivalEndpointCode(flight)]) {
    if (!code) continue;
    const airport = airports.get(code);
    if (!airport) continue;
    const continent = getContinent(airport.lat, airport.lon, airport.country);
    if (continent) touched.add(continent);
  }
  return [...touched];
}

export type FlightCountryReach = "domestic" | "international";

/**
 * Domestic or international, or `null` when the question cannot be answered:
 * an end with no code, or a code the catalogue has no country for. Null is
 * counted in NEITHER tally — a flight whose countries are unknown is not
 * evidence of a domestic one.
 */
export function flightCountryReach(
  flight: FlightEndpoints,
  airports: Map<string, AirportData>
): FlightCountryReach | null {
  const dep = departureEndpointCode(flight);
  const arr = arrivalEndpointCode(flight);
  if (!dep || !arr) return null;
  const depCountry = airports.get(dep)?.country;
  const arrCountry = airports.get(arr)?.country;
  if (!depCountry || !arrCountry) return null;
  return depCountry === arrCountry ? "domestic" : "international";
}

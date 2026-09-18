/**
 * Positions in, country-days out — and the positions are gone by the time this
 * function returns.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.4,
 * *"Store country-days, not tracks"*, and the July concept's §3, which makes
 * location history opt-in, encrypted at rest and **never sent to the
 * frontend**. This module is where that promise is actually kept: it is the
 * only place in the server that ever holds a Dawarich coordinate, it holds each
 * one for the length of one loop iteration, and nothing it returns can be
 * inverted back into a position.
 *
 * Deliberately source-agnostic. It takes `TimedPosition`, not `DawarichPoint`,
 * so a GPX track (`TripRouteTrack`, which already stores `source = "gpx"`) can
 * feed the same reduction without this file learning what Dawarich is.
 *
 * ## Two rules it does not decide
 *
 * - **The country lookup is injected, never imported.** `countryAt` comes from
 *   `services/geo/countryFromCoordinates.ts`, which abstains — null for the
 *   sea, for Antarctica and for the thirteen areas Natural Earth does not
 *   attribute. A null here drops the point and contributes nothing; there is no
 *   nearest-country fallback, because a guess is the failure the whole country
 *   rework exists to undo.
 * - **The day is a UTC day.** See the `CountryDay.date` comment in
 *   `schema.prisma`: a GPS fix carries no departure airport to borrow a clock
 *   from, and deriving a timezone from the coordinate would be an inference
 *   presented as a measurement.
 * - **"At an airport you flew through" is injected too.** `atKnownAirport` comes
 *   from `services/countryDays/knownAirports.ts`, built from the account's own
 *   flown flights. This file only counts how many points it answered yes for;
 *   what that count MEANS is `services/stats/trackEvidence.ts`'s decision.
 *
 * ## Why the airport question is asked HERE and nowhere later
 *
 * Spec §8.2: *"A GPS point in Doha is still a point in Qatar even if you never
 * left the terminal."* Telling a connection from a visit needs the coordinates
 * and the airports in the same breath — and by the time a `CountryDay` row
 * exists the coordinates are gone, deliberately and permanently. So the answer
 * either leaves this loop as a number or it does not exist at all.
 */

import { haversineKm } from "../../shared/geo/haversine";

/** The only three fields the reduction reads. `DawarichPoint` satisfies it. */
export interface TimedPosition {
  latitude: number;
  longitude: number;
  /** Milliseconds since epoch. */
  timestampMs: number;
}

/** One finished row, ready for `CountryDay`. Carries no position. */
export interface CountryDayObservation {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  /** How many points attested this country on this day. */
  pointCount: number;
  /**
   * How many of those points lay on the grounds of an airport this account is
   * known to have flown through — never which airport, and never where.
   *
   * A count, not a verdict. `pointCount === airportPointCount` is what
   * `services/stats/trackEvidence.ts` reads as "airside only"; publishing the
   * two numbers rather than the conclusion keeps the rule in one place and
   * leaves the evidence legible beside it, the same discipline §8.3 asks of
   * `pointCount` itself.
   */
  airportPointCount: number;
  /**
   * The diagonal of the bounding box of those points, in kilometres — how far
   * apart they were, never where they were. Zero for a single point, and
   * genuinely zero: this is a derived span, not an abstention, so there is no
   * null state to keep apart from it.
   */
  spanKm: number;
}

/**
 * The live bounding box. Never returned, never logged, never stored — it exists
 * only so `spanKm` can be computed in one pass instead of keeping the points.
 */
interface DayBucket {
  countryCode: string;
  date: string;
  pointCount: number;
  airportPointCount: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * "Is this position on the grounds of an airport this account flew through?"
 *
 * Injected, like `countryAt`, so this file stays source-agnostic and knows
 * nothing about flights. A caller that has no flights to compare against passes
 * nothing, and every point answers no — which reports "nothing was airside" and
 * so errs towards the STRONGER tier, the safe direction for an inferred hint.
 */
export type KnownAirportTest = (lat: number, lon: number) => boolean;

/**
 * Accumulates across several windows, because a truncated month is re-pulled as
 * smaller windows and their days must merge rather than compete.
 */
export type CountryDayAccumulator = Map<string, DayBucket>;

export function createCountryDayAccumulator(): CountryDayAccumulator {
  return new Map();
}

/** `YYYY-MM-DD` in UTC. */
export function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * Fold one batch of positions into the accumulator.
 *
 * A point whose timestamp is not finite is dropped rather than bucketed into
 * the epoch — the client already guarantees finite values, and a defensive
 * `new Date(NaN).toISOString()` would throw rather than lie, which is worse
 * here than skipping the row.
 */
export function accumulateCountryDays(
  accumulator: CountryDayAccumulator,
  points: readonly TimedPosition[],
  countryAt: (lat: number, lon: number) => string | null,
  atKnownAirport: KnownAirportTest = () => false
): void {
  for (const point of points) {
    if (!Number.isFinite(point.timestampMs)) continue;

    const countryCode = countryAt(point.latitude, point.longitude);
    // The sea, Antarctica, an unattributed area, or a coordinate that is not
    // one. An abstention, never a nearest-neighbour guess.
    if (!countryCode) continue;

    // Asked here, of the position itself, because there is nowhere later: the
    // coordinate is gone by the end of this iteration.
    const airside = atKnownAirport(point.latitude, point.longitude) ? 1 : 0;
    const date = utcDay(point.timestampMs);
    const key = `${date} ${countryCode}`;
    const bucket = accumulator.get(key);

    if (!bucket) {
      accumulator.set(key, {
        countryCode,
        date,
        pointCount: 1,
        airportPointCount: airside,
        minLat: point.latitude,
        maxLat: point.latitude,
        minLon: point.longitude,
        maxLon: point.longitude,
      });
      continue;
    }

    bucket.pointCount += 1;
    bucket.airportPointCount += airside;
    if (point.latitude < bucket.minLat) bucket.minLat = point.latitude;
    if (point.latitude > bucket.maxLat) bucket.maxLat = point.latitude;
    if (point.longitude < bucket.minLon) bucket.minLon = point.longitude;
    if (point.longitude > bucket.maxLon) bucket.maxLon = point.longitude;
  }
}

/**
 * Finish the accumulator into rows, discarding every coordinate it held.
 *
 * Sorted by day then country so two runs over the same window produce byte-
 * identical output and a test can assert an order.
 */
export function drainCountryDays(accumulator: CountryDayAccumulator): CountryDayObservation[] {
  const observations: CountryDayObservation[] = [];

  for (const bucket of accumulator.values()) {
    observations.push({
      date: bucket.date,
      countryCode: bucket.countryCode,
      pointCount: bucket.pointCount,
      airportPointCount: bucket.airportPointCount,
      spanKm: haversineKm(
        { lat: bucket.minLat, lon: bucket.minLon },
        { lat: bucket.maxLat, lon: bucket.maxLon }
      ),
    });
  }

  return observations.sort(
    (a, b) => a.date.localeCompare(b.date) || a.countryCode.localeCompare(b.countryCode)
  );
}

/** One-shot convenience. Use the accumulator when a window arrives in pieces. */
export function reduceToCountryDays(
  points: readonly TimedPosition[],
  countryAt: (lat: number, lon: number) => string | null,
  atKnownAirport?: KnownAirportTest
): CountryDayObservation[] {
  const accumulator = createCountryDayAccumulator();
  accumulateCountryDays(accumulator, points, countryAt, atKnownAirport);
  return drainCountryDays(accumulator);
}

/**
 * Positions in, country-days out — and the positions are gone by the time this
 * function returns.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.4,
 * *"Store country-days, not tracks"*, and the July concept's §3, which makes
 * location history opt-in, encrypted at rest and **never sent to the
 * frontend**. This module is where that promise is actually kept: it is the
 * only place in the server that reads a Dawarich coordinate, the sweep holds
 * one month of them in memory only until this reduction has run (the speed rule
 * below needs each point's neighbours), and nothing it returns can be inverted
 * back into a position.
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
 * ## Points taken in the air never reach a row (forgejo#299)
 *
 * *"Ein Überflug oder fehlerhafter Standort darf weder Bodenkontakt noch
 * Besuch belegen"* — and until 2026-10-16 every fix a phone took at cruising
 * altitude became a country-day: Syria from one point on EK052, Romania from
 * 1,686 on LH718, Cape Verde from 111 on LH506. Two independent rules now drop
 * such a point before it is bucketed, and a dropped point creates no day and
 * extends none:
 *
 * 1. **Inside a flown flight's air time** (`inFlight`, built from the account's
 *    flights by `./flightAirTime.ts`) in any country but that flight's two
 *    airports' countries.
 * 2. **Moving at airliner speed** — faster than `AIRBORNE_SPEED_KMH` to the
 *    point before it AND to the point after it — whether or not a flight was
 *    ever entered. A point on the grounds of a known airport is exempt: the
 *    aircraft there is landing, taxiing or at the gate, and a short layover
 *    between two long hops must not vanish with the hops.
 *
 * Rule 2 is also the outlier rule #299 asks for: a single fix that jumps
 * hundreds of kilometres away and back is fast on both sides and goes with the
 * flight points. Neither rule turns a dropped point into a weaker kind of
 * evidence — #299's table puts an overflight in neither "am Boden gewesen" nor
 * "besucht", so there is nothing to keep it as.
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
 * "Was a position at this instant, resolved to this country, taken in the air
 * on a flight this account flew?" — `./flightAirTime.ts`. Injected like the
 * other two questions; omitted, nothing is in flight.
 */
export type InFlightTest = (timestampMs: number, countryCode: string) => boolean;

/**
 * Faster than any ground transport a traveller rides, slower than any airliner
 * in cruise (800–900 km/h) or in the climb most fixes are taken in. Not 250:
 * high-speed rail runs at 300–350 km/h (ICE, TGV, the Chinese lines), and a
 * train through a country is ground contact under #299 — this rule exists to
 * remove the cabin, not the carriage.
 */
const AIRBORNE_SPEED_KMH = 400;

/**
 * The shortest span a speed is measured over. Phones repeat a fix or jitter by
 * a few hundred metres within a second; measured over a minute those vanish,
 * while a minute of cruise is still ~14 km.
 */
const MIN_SPEED_SPAN_MS = 60_000;

const MS_PER_HOUR = 3_600_000;

function speedKmh(a: TimedPosition, b: TimedPosition): number {
  const hours = Math.abs(b.timestampMs - a.timestampMs) / MS_PER_HOUR;
  if (hours === 0) return 0;
  return (
    haversineKm({ lat: a.latitude, lon: a.longitude }, { lat: b.latitude, lon: b.longitude }) /
    hours
  );
}

/**
 * Which of these time-ordered points were taken at airliner speed: fast to the
 * nearest point at least `MIN_SPEED_SPAN_MS` before AND to the nearest one at
 * least that long after. A point without such a neighbour on one side is never
 * judged airborne — the first fix of a window cannot be told from a departure.
 */
export function airborneBySpeed(sorted: readonly TimedPosition[]): boolean[] {
  const airborne = new Array<boolean>(sorted.length).fill(false);
  // `before`: the latest index at least a span earlier; `after`: the earliest
  // index at least a span later. Both only move forward, so this is one pass.
  let before = -1;
  let after = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const at = sorted[i].timestampMs;
    while (before + 1 < i && at - sorted[before + 1].timestampMs >= MIN_SPEED_SPAN_MS) {
      before += 1;
    }
    if (after <= i) after = i + 1;
    while (after < sorted.length && sorted[after].timestampMs - at < MIN_SPEED_SPAN_MS) {
      after += 1;
    }
    if (before < 0 || after >= sorted.length) continue;
    airborne[i] =
      speedKmh(sorted[before], sorted[i]) > AIRBORNE_SPEED_KMH &&
      speedKmh(sorted[i], sorted[after]) > AIRBORNE_SPEED_KMH;
  }
  return airborne;
}

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
 * Pass a window WHOLE rather than in slices: the speed rule compares each point
 * with its neighbours in time, and a point at the edge of a slice has none.
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
  atKnownAirport: KnownAirportTest = () => false,
  inFlight: InFlightTest = () => false
): void {
  // The speed rule needs neighbours in time order, and Dawarich answers
  // newest-first. A sorted copy: the caller's array is not ours to reorder.
  const ordered = points
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const fast = airborneBySpeed(ordered);

  for (let i = 0; i < ordered.length; i += 1) {
    const point = ordered[i];
    // Asked here, of the position itself, because there is nowhere later: the
    // coordinate is gone by the end of this iteration.
    const atAirport = atKnownAirport(point.latitude, point.longitude);
    // Airliner speed away from an airport: the cabin, not the ground.
    if (fast[i] && !atAirport) continue;

    const countryCode = countryAt(point.latitude, point.longitude);
    // The sea, Antarctica, an unattributed area, or a coordinate that is not
    // one. An abstention, never a nearest-neighbour guess.
    if (!countryCode) continue;

    // Inside a flown flight's air time, over a country it does not land in.
    if (inFlight(point.timestampMs, countryCode)) continue;

    const airside = atAirport ? 1 : 0;
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
  atKnownAirport?: KnownAirportTest,
  inFlight?: InFlightTest
): CountryDayObservation[] {
  const accumulator = createCountryDayAccumulator();
  accumulateCountryDays(accumulator, points, countryAt, atKnownAirport, inFlight);
  return drainCountryDays(accumulator);
}

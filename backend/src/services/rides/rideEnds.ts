import { AppError } from "../../middleware/errorHandler";
import { isLocalDayInput } from "../../schemas/wallClockInput";
import { endHasClock } from "../../shared/railClock";
import { LocalTimeNonexistentError, TzUnresolvedError } from "../../shared/time/errors";
import { localDay, toInstant, type Fold } from "../../shared/time/instant";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { formatWallClockIn } from "../../shared/zonedWallClock";
import { calculateDistance } from "../../utils/geo";

/**
 * The ends of a ride: a departure and an arrival, each a wall clock at a place
 * that has a zone. Rail and bus both write rides this way and must answer the
 * same questions the same way — a skipped hour, a clockless day, a moved stop,
 * an arrival before its departure — so the rules live here once and each
 * domain passes in only what is its own (the refusal code). They were two
 * copies until the review of 2026-10-07 found them one fix away from drifting
 * apart; a fix to a rule now reaches both domains or neither.
 */

export interface EndReading {
  time: Date;
  precision: "minute" | "day";
}

/** The refusal codes an arrival before its departure may carry, one per domain. */
export type ArrivalBeforeDepartureCode =
  "RAIL_ARRIVAL_BEFORE_DEPARTURE" | "BUS_ARRIVAL_BEFORE_DEPARTURE";

/**
 * The instant a stop's wall clock names, read back from a STORED row or a
 * seed: a machine reading through `shared/time` (a skipped hour is not
 * refused). A stored row without a zone was written as UTC and is read back
 * as UTC — the one place this fallback survives, because it only restores
 * what that row already holds. A clock a request SENDS goes through
 * `sentWallClockToInstant`, which never falls back.
 */
export function wallClockToInstant(wall: string, timezone: string | null): Date {
  const normalised = wall.length === 16 ? `${wall}:00` : wall;
  return timezone
    ? toInstant(normalised, timezone, { origin: "machine" }).utc
    : new Date(`${normalised}Z`);
}

/**
 * A wall clock the USER sent, as an instant — refused when that clock never
 * showed it. On a spring-forward day one hour does not exist (02:30 on
 * 29 March 2026 in Europe/Berlin); `fromZonedTime` answers anyway, with an
 * instant an hour off, which read back as 01:30 and could even turn a valid
 * ride into "arrival before departure". Same rule and same check
 * (`shared/wallClockExistence.ts`) the flight schema applies; the repeated
 * autumn hour is a real time and passes.
 */
export function sentWallClockToInstant(
  wall: string,
  timezone: string | null,
  field: "departureLocal" | "arrivalLocal",
  fold: Fold | null | undefined
): Date {
  // A stop the resolver cannot place in a zone has no clock to read the
  // time on; it used to be read as UTC in silence (ADR 0002 D2).
  if (!timezone) throw new TzUnresolvedError("the stop has no zone", field);
  try {
    return toInstant(wall, timezone, { origin: "typed", fold: fold ?? "earlier" }).utc;
  } catch (error) {
    if (!(error instanceof LocalTimeNonexistentError)) throw error;
    // The time model's general refusal (422 LOCAL_TIME_NONEXISTENT, ADR 0002
    // D3), naming the field. Rail answered 400 RAIL_LOCAL_TIME_NONEXISTENT
    // until phase 4; the web maps both codes, the Companion neither.
    throw new LocalTimeNonexistentError(wall, timezone, field);
  }
}

/**
 * The inverse: what the stop's clock read at `instant`, as `YYYY-MM-DDTHH:mm`.
 * Read through `shared/zonedWallClock.ts` — the one home for "instant to wall
 * clock", because `formatInTimeZone` slid a reading inside the HOST's own
 * spring-forward gap by an hour. A zone the runtime rejects reads as UTC, the
 * same fallback a stop without a zone gets.
 */
export function instantToWallClock(instant: Date, timezone: string | null): string {
  const wall = formatWallClockIn(instant, timezone ?? "UTC") ?? formatWallClockIn(instant, "UTC");
  if (!wall) throw new RangeError("instantToWallClock: invalid instant");
  return wall.slice(0, 16);
}

/** Great-circle kilometres, one decimal — enough for a statistic, honest about being straight. */
export function greatCircleKm(state: {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}): number {
  const km = calculateDistance(state.depLat, state.depLon, state.arrLat, state.arrLon);
  return Math.round(km * 10) / 10;
}

/**
 * One end's instant and precision. Sent: a wall clock is converted in the
 * stop's zone (a skipped hour refused), a bare day becomes the start of that
 * day there with precision `day` (forgejo#132 item 17). Not sent: the stored
 * end stays — a clock read back from its instant exists by construction, and
 * a side whose clock AND stop were not sent keeps its stored instant, since
 * re-reading would put a ride in the repeated autumn hour back at the earlier
 * one. A clockless end stays clockless when its stop moves: the same day, at
 * the new stop. A stop that moved to a place without a zone is refused, like a
 * sent clock — the ticket's clock is never quietly re-read as UTC.
 */
export function resolveEnd(args: {
  sent: string | null | undefined;
  fold: Fold | null | undefined;
  zone: string | null;
  stopMoved: boolean;
  stored: { time: Date; zone: string | null; precision: string | null } | null;
  field: "departureLocal" | "arrivalLocal";
}): EndReading | null {
  const { sent, zone, stored, field } = args;
  if (sent === null) return null;
  if (sent !== undefined) {
    if (isLocalDayInput(sent)) {
      if (!zone) throw new TzUnresolvedError("the stop has no zone", field);
      return { time: startOfDayAt(sent, zone), precision: "day" };
    }
    return { time: sentWallClockToInstant(sent, zone, field, args.fold), precision: "minute" };
  }
  if (!stored) return null;
  if (!endHasClock(stored.precision)) {
    if (!args.stopMoved) return { time: stored.time, precision: "day" };
    if (!zone) throw new TzUnresolvedError("the stop has no zone", field);
    const day = localDay(stored.time, stored.zone ?? "UTC");
    return { time: wallClockToInstant(`${day}T00:00`, zone), precision: "day" };
  }
  if (!args.stopMoved) return { time: stored.time, precision: "minute" };
  if (!zone) throw new TzUnresolvedError("the stop has no zone", field);
  return {
    time: wallClockToInstant(instantToWallClock(stored.time, stored.zone), zone),
    precision: "minute",
  };
}

/**
 * Arrival not before departure. Two clocks compare as instants; with a
 * clockless end only the stop days can be compared — a ride logged for the
 * 5th that arrives at 08:00 on the 5th is fine, one arriving on the 4th is not.
 */
export function assertArrivalNotBefore(
  departure: EndReading,
  depZone: string | null,
  arrival: EndReading | null,
  arrZone: string | null,
  code: ArrivalBeforeDepartureCode
): void {
  if (!arrival) return;
  const bothClocked = departure.precision === "minute" && arrival.precision === "minute";
  const before = bothClocked
    ? arrival.time.getTime() < departure.time.getTime()
    : localDay(arrival.time, arrZone ?? "UTC") < localDay(departure.time, depZone ?? "UTC");
  if (before) {
    throw new AppError("arrival must not precede departure", 400, code, "arrivalLocal");
  }
}

/**
 * A typed distance is kept until the user clears it; a measured one follows
 * the stops. Clearing (`null`) means "measure it again".
 */
export function resolveDistance(
  existing: { distanceKm: number | null; distanceSource: string | null } | null,
  input: { distanceKm?: number | null },
  coords: { depLat: number; depLon: number; arrLat: number; arrLon: number }
): { distanceKm: number; distanceSource: string } {
  if (typeof input.distanceKm === "number") {
    return { distanceKm: input.distanceKm, distanceSource: "user" };
  }
  if (
    input.distanceKm === undefined &&
    existing?.distanceSource === "user" &&
    existing.distanceKm != null
  ) {
    return { distanceKm: existing.distanceKm, distanceSource: "user" };
  }
  return { distanceKm: greatCircleKm(coords), distanceSource: "great_circle" };
}

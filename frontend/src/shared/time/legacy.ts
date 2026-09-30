/**
 * Reading a value the server sent in its PRE-`times` form (ADR 0002, phase 4).
 *
 * WEB-ONLY — the server has its own reader for the backfill
 * (`backend/src/shared/time/legacyValues.ts`); this one only ever displays.
 *
 * Phase 4 is additive: every entity gains a `times` object beside its old
 * fields, and a payload that predates it (an older server, a list endpoint
 * that has not moved yet, a cached response) still has to show the right
 * clock. These three readers turn the old fields into the same `TimeValue` /
 * `LocalDateValue` the new ones carry, so the components above know one shape.
 * They go in phase 6, together with the fields they read.
 *
 * None of them invents a zone. A value whose zone is not known is read on the
 * UTC clock and says so (`zone: null`, offset `+00:00`) — `readsAsUtc` lets the
 * screen label it "UTC" instead of passing it off as a place's time.
 */
import type { LocalDateValue, TimePrecision, TimeValue } from "./wire";
import { isValidZone, toLocal } from "./zone";

const ISO_WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/;

function parseInstant(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A real instant with the zone of its place (flights, rail, and the phase-2
 * `*Utc` + `*Zone` columns). A zone the runtime does not know, or none at
 * all, reads on the UTC clock and is marked `zone: null`.
 */
export function timeValueAtZone(
  utc: string | null | undefined,
  zone: string | null | undefined,
  precision: TimePrecision = "minute"
): TimeValue | null {
  if (!utc) return null;
  const instant = parseInstant(utc);
  if (!instant) return null;
  const iso = instant.toISOString();
  if (zone && isValidZone(zone)) {
    const { local, offset } = toLocal(instant, zone);
    return { utc: iso, zone, offset, local, precision };
  }
  return { utc: iso, zone: null, offset: "+00:00", local: iso.slice(0, 19), precision };
}

/**
 * A wall clock stored as if it were UTC ("fake UTC": trip stops, cruise stop
 * times, visits written before phase 2). Its UTC components ARE the place's
 * clock, so they are shown as they are. Midnight exactly was the "no time
 * given" convention, which is why it reads as a day.
 *
 * `utc` repeats the stored value: it is the only order these rows ever had.
 * `offset` is empty because nobody knows it — which is also what keeps
 * `readsAsUtc` from calling the wall clock a UTC reading.
 */
export function timeValueFromWallClock(stored: string | null | undefined): TimeValue | null {
  if (!stored) return null;
  const instant = parseInstant(stored);
  if (!instant) return null;
  const iso = instant.toISOString();
  const match = ISO_WALL.exec(iso);
  if (!match) return null;
  const midnight = iso.slice(11, 19) === "00:00:00";
  return {
    utc: iso,
    zone: null,
    offset: "",
    local: iso.slice(0, 19),
    precision: midnight ? "day" : "minute",
  };
}

/**
 * A calendar day stored in a timestamp column at UTC midnight (stays, cruise
 * and trip days, journal days): the day is the UTC date, read with UTC
 * getters only, so no reader's zone can move it (ADR D1).
 */
export function localDateFromDayColumn(
  stored: string | null | undefined,
  zone: string | null = null
): LocalDateValue | null {
  if (!stored) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})$/.exec(stored);
  if (direct) return { date: direct[1], zone, precision: "day" };
  const instant = parseInstant(stored);
  if (!instant) return null;
  return { date: instant.toISOString().slice(0, 10), zone, precision: "day" };
}

/** True when a value is shown on the UTC clock because its place has no known zone. */
export function readsAsUtc(value: TimeValue): boolean {
  return value.zone === null && value.offset === "+00:00";
}

/**
 * The time window a cruise leg was sailed in — what "pull this leg from
 * Dawarich" asks for.
 *
 * Built from DAYS, widened on both sides, and deliberately loose. A stop's
 * `date` is a calendar day in the port's own time, stored as UTC midnight, and
 * its arrival and departure times are often missing or typed as local times;
 * a window cut tightly to those would lose the first hours out of port on any
 * ship east of Greenwich. Too wide costs only a few extra points, because the
 * leg is cut out of the recording by where the ship WAS
 * (`services/trackCoverage/legCoverage.ts`), never by the clock.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** UTC±14 is the widest offset in use (Kiribati), so a local day starts no
 *  more than 14 hours before and ends no more than 14 hours after UTC's. */
const LOCAL_DAY_MARGIN_MS = 14 * HOUR_MS;

export interface WindowStop {
  date: Date | null;
}

export interface CruiseWindowBounds {
  startDate: Date | null;
  endDate: Date | null;
}

export interface TimeWindow {
  startAt: Date;
  endAt: Date;
}

function dayStart(day: Date): Date {
  const utc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return new Date(utc - LOCAL_DAY_MARGIN_MS);
}

function dayEnd(day: Date): Date {
  const utc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return new Date(utc + DAY_MS + LOCAL_DAY_MARGIN_MS);
}

/**
 * `fromStop`/`toStop` are null for the cruise's departure and arrival ports,
 * which live on the cruise rather than in its stops — those sides fall back to
 * the cruise's own start and end. Null when a side has no day at all, or the
 * two sides come out inverted (a stop dated before the one it follows).
 */
export function cruiseLegWindow(
  fromStop: WindowStop | null,
  toStop: WindowStop | null,
  cruise: CruiseWindowBounds
): TimeWindow | null {
  const fromDay = fromStop?.date ?? cruise.startDate;
  const toDay = toStop?.date ?? cruise.endDate;
  if (fromDay === null || toDay === null) return null;
  const window = { startAt: dayStart(fromDay), endAt: dayEnd(toDay) };
  return window.endAt.getTime() > window.startAt.getTime() ? window : null;
}

/** The whole voyage: first day to last, from the cruise or else its stops. */
export function cruiseWindow(
  stops: ReadonlyArray<WindowStop>,
  cruise: CruiseWindowBounds
): TimeWindow | null {
  const days = stops.map((s) => s.date).filter((d): d is Date => d !== null);
  const sorted = [...days].sort((a, b) => a.getTime() - b.getTime());
  const first = cruise.startDate ?? sorted[0] ?? null;
  const last = cruise.endDate ?? sorted[sorted.length - 1] ?? null;
  if (first === null || last === null) return null;
  const window = { startAt: dayStart(first), endAt: dayEnd(last) };
  return window.endAt.getTime() > window.startAt.getTime() ? window : null;
}

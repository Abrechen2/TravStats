/**
 * Reading an instant in an IANA zone — the web half of the time model
 * (ADR 0002, D5).
 *
 * MIRRORED at backend/src/shared/time — change both together. Both sides are
 * proven against the same `backend/src/shared/time/vectors.json`.
 *
 * Display-only: the web never decides a zone and never turns a wall clock into
 * an instant — the server does that once, on write (D3). What the browser
 * needs is to read an instant it already has in a zone it was given, and to
 * know which calendar day "today" is in the user's profile zone.
 *
 * Everything goes through `Intl.DateTimeFormat` with an explicit `timeZone`,
 * never through host-local `Date` getters: those answer in the READER's zone,
 * which is the bug class this module exists to end. date-fns-tz is not used
 * either — its `formatInTimeZone` builds the reading as a host-local Date and
 * slides one hour a year inside the host's own DST gap.
 */

/** A zone name the runtime does not know (a newer tzdata, a typo). */
export class ZoneUnknownError extends Error {
  readonly code = "ZONE_UNKNOWN";
  constructor(readonly zone: string) {
    super(`Unknown time zone: ${zone}`);
    this.name = "ZoneUnknownError";
  }
}

/** The clock in a zone, as numbers. `month` is 1-12. */
export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * One formatter per zone — building one costs far more than using it, and a
 * list page reads the clock for every row. `null` marks a zone the runtime
 * rejected, so an unusable name is not re-tried on each call.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23 so midnight reads 00 rather than 24.
      hourCycle: "h23",
    });
  } catch {
    formatter = null;
  }
  formatters.set(zone, formatter);
  return formatter;
}

/** Whether the runtime knows `zone`. */
export function isValidZone(zone: string): boolean {
  return typeof zone === "string" && zone.length > 0 && formatterFor(zone) !== null;
}

/** An instant from a `Date`, an ISO string with offset, or epoch ms. */
export type InstantLike = Date | string | number;

function toDate(instant: InstantLike): Date {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not an instant: ${String(instant)}`);
  }
  return date;
}

/**
 * The clock `zone` showed at `instant`, or null for a zone the runtime does
 * not know. The null form exists for the older helpers that delegate here
 * (`zonedWallClock.ts`, `localWallClock.ts`); new code uses `toLocal`.
 */
export function wallClockPartsOrNull(instant: Date, zone: string): WallClockParts | null {
  const formatter = formatterFor(zone);
  if (!formatter || Number.isNaN(instant.getTime())) return null;
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? "x", 10);
  const result: WallClockParts = {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function wallClockParts(instant: Date, zone: string): WallClockParts {
  const parts = wallClockPartsOrNull(instant, zone);
  if (!parts) throw new ZoneUnknownError(zone);
  return parts;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function datePart(p: WallClockParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "+05:45", "-03:30", "+00:00" — seconds only where a historical zone had them. */
export function formatOffset(offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? "-" : "+";
  const abs = Math.abs(offsetSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  return `${sign}${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ""}`;
}

/** Seconds the clock in `zone` is ahead of UTC at `instant`. */
function offsetSecondsAt(instant: Date, parts: WallClockParts): number {
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - instantSeconds) / 1000);
}

/** What `toLocal` answers: the wall clock and the offset in force. */
export interface LocalReading {
  /** `YYYY-MM-DDTHH:mm`, the shape the write API accepts (D3). */
  local: string;
  /** The offset in force at that instant, e.g. `+02:00`. */
  offset: string;
}

/**
 * The wall clock and offset `zone` showed at `utc`. Throws
 * `ZoneUnknownError` for a zone the runtime does not know — the caller that
 * holds a server payload displays its `local`/`offset` instead (see
 * `formatTimeValue`), it never guesses.
 */
export function toLocal(utc: InstantLike, zone: string): LocalReading {
  const instant = toDate(utc);
  const parts = wallClockParts(instant, zone);
  return {
    local: `${datePart(parts)}T${pad(parts.hour)}:${pad(parts.minute)}`,
    offset: formatOffset(offsetSecondsAt(instant, parts)),
  };
}

/** The calendar day (`YYYY-MM-DD`) `zone` was on at `utc`. */
export function localDay(utc: InstantLike, zone: string): string {
  return datePart(wallClockParts(toDate(utc), zone));
}

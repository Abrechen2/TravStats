/**
 * The wall clock an instant shows in an IANA zone, read through `Intl` —
 * the one primitive every conversion in `shared/time` is built on.
 *
 * `Intl` and not `formatInTimeZone`/`toZonedTime` from date-fns-tz 3.2.0:
 * those build the target reading as a HOST-local `Date`, so when it falls in
 * the host machine's own spring-forward gap the runtime slides it an hour on
 * (measured with the host in Europe/Berlin: `formatInTimeZone(new
 * Date("2025-03-30T02:30Z"), "UTC", …)` returned 03:30). `Intl` reads the zone
 * directly and never consults the host's.
 */

export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** One formatter per zone — building one costs far more than using it. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
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
    // RangeError for a zone this runtime does not know — the answer, not a
    // failure. Cached as null so the caller decides what an unknown zone means.
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Accepts IANA names (`Europe/Berlin`, `UTC`, `Etc/GMT+5`) the runtime knows.
 * Refuses raw offsets like `+05:00`, which newer runtimes accept as a
 * `timeZone`: an offset is not a place and has no DST, so a value stored with
 * one would silently stop matching its place's clock at the next transition.
 */
const IANA_NAME = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+)$/;

export function isValidZone(zone: unknown): zone is string {
  return typeof zone === "string" && IANA_NAME.test(zone) && formatterFor(zone) !== null;
}

/** The wall-clock components of an instant in a zone; null for an unknown zone or invalid instant. */
export function wallClockParts(instantMs: number, zone: string): WallClockParts | null {
  const formatter = formatterFor(zone);
  if (!formatter || !Number.isFinite(instantMs)) return null;
  const parts = formatter.formatToParts(new Date(instantMs));
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
  };
}

/** Wall-clock components encoded as if they were UTC — the arithmetic form of a local reading. */
export function partsToUtcMs(p: WallClockParts): number {
  // Not `Date.UTC(year, …)`: it reads years 0-99 as 1900-1999, so a stay
  // dated 0001-01-01 became 1901 and passed as a real day of another century.
  const date = new Date(0);
  date.setUTCFullYear(p.year, p.month - 1, p.day);
  date.setUTCHours(p.hour, p.minute, p.second, 0);
  return date.getTime();
}

/**
 * The zone's offset from UTC at an instant, in milliseconds (east positive).
 * Null for an unknown zone. Whole seconds only: `Intl` does not report
 * milliseconds, so the instant is floored before comparing.
 */
export function offsetMsAt(instantMs: number, zone: string): number | null {
  const parts = wallClockParts(instantMs, zone);
  if (!parts) return null;
  const flooredToSecond = Math.floor(instantMs / 1000) * 1000;
  return partsToUtcMs(parts) - flooredToSecond;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** `YYYY-MM-DDTHH:mm:ss` of wall-clock components. */
export function formatParts(p: WallClockParts): string {
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  );
}

/**
 * An offset as RFC 3339 writes it: `+05:45`, `-03:30`, `+00:00`. Minutes
 * only — RFC 3339 has no seconds field, and the only offsets with seconds are
 * pre-1900 local mean times no travel record carries.
 */
export function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const totalMinutes = Math.round(Math.abs(offsetMs) / 60_000);
  return `${sign}${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

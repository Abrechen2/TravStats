/**
 * The wall clock an instant shows in an IANA zone, as `YYYY-MM-DDTHH:mm:ss`.
 *
 * This exists because `formatInTimeZone` from date-fns-tz 3.2.0 is wrong one
 * hour a year per host: it builds the target reading as a HOST-local `Date`,
 * so when that reading falls into the host machine's own spring-forward gap
 * the runtime slides it an hour on. Measured: with the host in Europe/Berlin,
 * `formatInTimeZone(new Date("2025-03-30T02:30Z"), "UTC", …)` returns 03:30.
 * `Intl.DateTimeFormat` reads the zone directly and has no such gap.
 *
 * Returns null for a zone the runtime rejects, so the caller decides what an
 * unusable zone means instead of receiving a made-up clock.
 *
 * MIRRORED at `frontend/src/shared/zonedWallClock.ts` — change both together.
 */

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
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

export function formatWallClockIn(instant: Date, timeZone: string): string | null {
  const formatter = formatterFor(timeZone);
  if (!formatter || Number.isNaN(instant.getTime())) return null;
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return (
    `${value("year")}-${value("month")}-${value("day")}` +
    `T${value("hour")}:${value("minute")}:${value("second")}`
  );
}

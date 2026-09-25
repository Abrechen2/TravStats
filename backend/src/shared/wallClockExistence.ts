import { fromZonedTime } from "date-fns-tz";

/**
 * Does this wall-clock reading exist in this timezone at all?
 *
 * On a spring-forward day one hour never happens. 02:30 on 30 March 2025 is
 * not a time in Europe/Berlin: the clocks go straight from 02:00 CET to 03:00
 * CEST. `fromZonedTime` answers anyway — it picks an offset and returns an
 * instant — so the server accepted the flight with a 201 and stored 00:30Z.
 * The detail page then read that instant back as 01:30, an hour the user
 * never typed (audit 2026-09-20, SRV-TIMEZONE-GAP-001). Nothing warned; the
 * time was simply different afterwards.
 *
 * The test is a round trip: convert to an instant, read the instant back in
 * the same zone, and compare it with what was sent. A time that exists comes
 * back unchanged. A time in the gap comes back as some other time, which is
 * precisely the silent shift.
 *
 * The AUTUMN repeated hour deliberately passes. 02:30 on 26 October happens
 * twice in Berlin; `fromZonedTime` picks one of them and the round trip
 * returns 02:30 either way. An ambiguous time is a real time — the user gets
 * the earlier reading rather than a refusal, which is the smaller surprise.
 *
 * **The read-back is `Intl`, NOT `formatInTimeZone`, and that is the whole
 * reason this file does its own formatting.** Measured on date-fns-tz 3.2.0 /
 * date-fns 4.4.0: `formatInTimeZone(new Date("2025-03-29T17:30Z"),
 * "Asia/Tokyo", …)` returns 03:30 where the correct answer is 02:30 — and it
 * is wrong for `UTC` too. It builds the target wall clock as a HOST-local
 * Date, so whenever that reading falls in the HOST machine's own DST gap, the
 * runtime slides it forward an hour. A helper that fails exactly on the hour
 * this function is looking for would have made the guard report every zone as
 * broken on one day a year and the real gap as fine.
 *
 * Backend-only, like `shared/flightChronology.ts` beside it: the frontend does
 * not validate times, so a mirror would be a copy with no second reader.
 */

/** Length of `YYYY-MM-DDTHH:mm`; anything longer carries seconds. */
const MINUTE_PRECISION = 16;

/** One formatter per zone — building one costs far more than using it. */
const readBackFormatters = new Map<string, Intl.DateTimeFormat | null>();

function readBackFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = readBackFormatters.get(timeZone);
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
      // h23 so midnight reads 00 rather than 24 — a 24 would look like a gap.
      hourCycle: "h23",
    });
  } catch {
    formatter = null;
  }
  readBackFormatters.set(timeZone, formatter);
  return formatter;
}

export function wallClockExists(local: string, timeZone: string): boolean {
  const formatter = readBackFormatter(timeZone);
  // An unusable zone is not this rule's complaint — `ianaTimezone` already
  // rejects it, and answering "does not exist" here would blame the clock.
  if (!formatter) return true;

  let instant: Date;
  try {
    instant = fromZonedTime(local, timeZone);
  } catch {
    return true;
  }
  if (Number.isNaN(instant.getTime())) return true;

  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const readBack =
    `${value("year")}-${value("month")}-${value("day")}` +
    `T${value("hour")}:${value("minute")}:${value("second")}`;

  return local.length > MINUTE_PRECISION
    ? readBack === local
    : readBack.slice(0, MINUTE_PRECISION) === local;
}

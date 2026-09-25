import { fromZonedTime } from "date-fns-tz";
import { formatWallClockIn } from "./zonedWallClock";

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
 * **The read-back is `Intl` (`shared/zonedWallClock.ts`), NOT
 * `formatInTimeZone`.** Measured on date-fns-tz 3.2.0 /
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

export function wallClockExists(local: string, timeZone: string): boolean {
  let instant: Date;
  try {
    instant = fromZonedTime(local, timeZone);
  } catch {
    return true;
  }
  const readBack = formatWallClockIn(instant, timeZone);
  // An unusable zone (or instant) is not this rule's complaint —
  // `ianaTimezone` already rejects it, and answering "does not exist" here
  // would blame the clock.
  if (readBack === null) return true;

  return local.length > MINUTE_PRECISION
    ? readBack === local
    : readBack.slice(0, MINUTE_PRECISION) === local;
}

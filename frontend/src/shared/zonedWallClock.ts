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
 * MIRROR of `backend/src/shared/zonedWallClock.ts` — change both together.
 *
 * @deprecated → shared/time (`toLocal`). Kept as a thin name until phase 6 of
 * the time-model plan deletes it in both trees.
 */

import { wallClockPartsOrNull } from "./time";

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Delegates to shared/time (ADR 0002), which owns the one zone formatter. */
export function formatWallClockIn(instant: Date, timeZone: string): string | null {
  const p = wallClockPartsOrNull(instant, timeZone);
  if (!p) return null;
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  );
}

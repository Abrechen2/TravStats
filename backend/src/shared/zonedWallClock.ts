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
 *
 * @deprecated → `shared/time` (`toLocal`, ADR 0002). Now a thin name over
 * `shared/time/zonedParts.ts`, the one Intl reader; deleted in phase 6. A raw
 * offset such as `+02:00` is no longer a usable zone here (null), because an
 * offset is not a place.
 */

import { formatParts, isValidZone, wallClockParts } from "./time/zonedParts";

export function formatWallClockIn(instant: Date, timeZone: string): string | null {
  if (!isValidZone(timeZone)) return null;
  const parts = wallClockParts(instant.getTime(), timeZone);
  return parts ? formatParts(parts) : null;
}

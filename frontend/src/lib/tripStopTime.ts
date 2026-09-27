import type { LocalTimeInput } from "../shared/time";
import { MissingZoneError, dayInput } from "./api/timeInput";

/**
 * A trip stop's start or end in the time model's write shape (ADR 0002, D3).
 *
 * A stop's time is the wall clock at the stop. It used to be written as
 * `YYYY-MM-DDTHH:mm:00.000Z` — the wall clock pretending to be UTC — which
 * the server now refuses from a browser (`TIME_SHAPE_REQUIRED`). Now:
 * - no date → null;
 * - a date without a time → the day, `YYYY-MM-DD`;
 * - a date and a time → `{ local }`: the zone is the one of the stop's own
 *   position, which travels in the same body; the server resolves it;
 * - a time on a stop without a position has nowhere to take a zone from and
 *   is refused here (`TZ_UNRESOLVED`) instead of being stored as UTC.
 */
export function tripStopTime(
  field: string,
  date: string,
  time: string,
  hasPosition: boolean
): LocalTimeInput | string | null {
  const day = dayInput(date);
  if (!day) return null;
  const clock = time.trim();
  if (!/^\d{2}:\d{2}$/.test(clock)) return day;
  if (!hasPosition) throw new MissingZoneError(field);
  return { local: `${day}T${clock}` };
}

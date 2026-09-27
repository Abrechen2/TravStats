import type { LocalTimeInput } from "../shared/time";
import { dayInput } from "./api/timeInput";

/**
 * A trip stop's start or end in the time model's write shape (ADR 0002, D3).
 *
 * A stop's time is the wall clock at the stop. It used to be written as
 * `YYYY-MM-DDTHH:mm:00.000Z` — the wall clock pretending to be UTC — which
 * the server now refuses from a browser (`TIME_SHAPE_REQUIRED`). Now:
 * - no date → null;
 * - a date without a time → the day, `YYYY-MM-DD`;
 * - a date and a time → `{ local }`. The SERVER finds the zone: the stop's
 *   own position (sent in the same body), else the entry the stop wraps;
 *   with neither it keeps the wall clock with precision `unknown` — never UTC.
 *   The web does not refuse it: that left every stored placeless stop with a
 *   time uneditable, and a wrapped stop's zone is one only the server knows.
 */
export function tripStopTime(date: string, time: string): LocalTimeInput | string | null {
  const day = dayInput(date);
  if (!day) return null;
  const clock = time.trim();
  if (!/^\d{2}:\d{2}$/.test(clock)) return day;
  return { local: `${day}T${clock}` };
}

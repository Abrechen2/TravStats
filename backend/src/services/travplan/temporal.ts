import { toInstant } from "../../shared/time/instant";
import type { PlanBooking } from "./types";
/** Unknown zones, skipped clocks and repeated DST hours remain unknown. */
export function instantMinute(
  day: string | null,
  time: string | null,
  zone: string | null
): number | null {
  if (!day || !time || !zone) return null;
  try {
    const result = toInstant(day + "T" + time, zone);
    return result.ambiguous ? null : +result.utc / 60000;
  } catch {
    return null;
  }
}
export function bookingDuration(b: PlanBooking): number | null {
  if (!["flight", "rail", "bus", "ferry"].includes(b.kind)) return null;
  const start = instantMinute(b.day, b.time, b.timezone),
    end = instantMinute(b.arrivalDay ?? null, b.arrivalTime ?? null, b.arrivalTimezone ?? null);
  return start !== null && end !== null && end >= start && end - start <= 1440
    ? Math.round(end - start)
    : null;
}

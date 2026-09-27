import { legacyDayOf } from "../../shared/time/legacyValues";
import { fromDbDate } from "../../shared/time/localDate";
import { serializeDay, type LocalDateValue } from "../../shared/time/wire";

/**
 * A day column on the read side (ADR 0002 phase 4): the `DATE` the time model
 * wrote, as `YYYY-MM-DD`; for a row the backfill has not reached yet, its
 * legacy `DateTime` anchor read by the backfill's own rule (`legacyDayOf`),
 * so the read side and the migration cannot disagree about which day a
 * legacy anchor holds. An anchor that rule will not place without guessing
 * (10:00–11:59 UTC) goes out with precision `unknown`.
 *
 * One home for every `times` builder that reads a day — stays, cruises,
 * cruise stops, trips, journal entries.
 */
export function readDay(
  day: Date | null,
  legacy: Date | null,
  zone: string | null,
  precision: LocalDateValue["precision"] = "day"
): LocalDateValue | null {
  if (day) return serializeDay(fromDbDate(day), zone, precision);
  if (!legacy) return null;
  const reading = legacyDayOf(legacy);
  return serializeDay(reading.day, zone, reading.ambiguous ? "unknown" : precision);
}

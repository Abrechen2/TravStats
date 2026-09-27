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

/**
 * A birthday's month (1-12) and day — a FLOATING date (ADR 0002 D1): the same
 * day everywhere, read from `birth_day`, else the legacy anchor by the
 * backfill's rule. Never through a host-local getter, which moved a birthday
 * stored at UTC midnight to the day before on any host west of UTC.
 */
export function birthdayOf(
  user: { birthDay?: Date | null; birthdate?: Date | null } | null | undefined
): { month: number; day: number } | undefined {
  const day = readDay(user?.birthDay ?? null, user?.birthdate ?? null, null);
  return day
    ? { month: Number(day.date.slice(5, 7)), day: Number(day.date.slice(8, 10)) }
    : undefined;
}

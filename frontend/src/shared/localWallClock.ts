/**
 * Frontend MIRROR of `localWallClockOf` in `backend/src/utils/timezone.ts`,
 * following the same backend/frontend mirror convention as `shared/domains.ts`.
 *
 * The overview tab buckets flights by year, month and weekday in the browser,
 * so it needs the same answer the server gives: the clock at the DEPARTURE
 * airport, not the viewer's own timezone and not the UTC instant (#266). A
 * 07:00 Berlin departure is a morning flight for everyone looking at it,
 * including a reader in Los Angeles.
 *
 * The zone reading itself is delegated to shared/time (ADR 0002); the
 * semantics switch below stays here until phase 6 removes the legacy
 * fake-UTC rows it exists for.
 */
import { wallClockPartsOrNull } from "./time";

export type FlightTimeSemantics = "UTC" | "DATE_ONLY" | "LEGACY_FAKE_UTC" | "UNKNOWN";

/** The clock as it read at the airport when the flight left. */
export interface LocalWallClock {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Calendar year. */
  year: number;
  /** 0-11, matching Date#getMonth. */
  month: number;
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
  weekday: number;
  /** 0-23, or null when the stored time is a DATE_ONLY placeholder. */
  hour: number | null;
}

interface Components {
  year: number;
  /** 1-12, as the formatter reports it. */
  month: number;
  day: number;
  hour: number;
}

/** The stored components read as-is, which is UTC on a Date. */
function storedComponents(stored: Date): Components {
  return {
    year: stored.getUTCFullYear(),
    month: stored.getUTCMonth() + 1,
    day: stored.getUTCDate(),
    hour: stored.getUTCHours(),
  };
}

/** The components on the clock in `timezone`, or null if it is unusable. */
function zonedComponents(stored: Date, timezone: string): Components | null {
  const parts = wallClockPartsOrNull(stored, timezone);
  return parts ? { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour } : null;
}

/**
 * Read a stored flight time as the wall clock at its airport.
 *
 * Which conversion applies depends on the row's storage semantics:
 *   - 'UTC' / 'UNKNOWN': the stored value is a real instant and is converted
 *     through the airport's timezone. UNKNOWN belongs here deliberately —
 *     treating it as legacy would shift the API-imported real-UTC rows that
 *     make up most of the untagged set.
 *   - 'LEGACY_FAKE_UTC': the stored components ARE the wall clock, encoded as
 *     UTC. Converting them would subtract the offset a second time.
 *   - 'DATE_ONLY': 12:00Z of the recorded day — a calendar day, not an
 *     instant, so it is never read through a zone and `hour` is null. At
 *     UTC+12 and beyond (Auckland, Fiji, Kiritimati) the converted
 *     placeholder is already the next local day (forgejo#273).
 * Without a timezone the stored components are the best available reading.
 */
export function localWallClockOf(
  stored: Date,
  timezone: string | null | undefined,
  semantics: FlightTimeSemantics = "UNKNOWN"
): LocalWallClock {
  const useStored = semantics === "LEGACY_FAKE_UTC" || semantics === "DATE_ONLY" || !timezone;
  const { year, month, day, hour } =
    (useStored ? null : zonedComponents(stored, timezone as string)) ?? storedComponents(stored);

  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month: month - 1,
    // Derived from the local calendar date rather than parsed from a locale
    // weekday name, which would depend on the formatter's language.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: semantics === "DATE_ONLY" ? null : hour,
  };
}

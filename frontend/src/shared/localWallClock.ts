/**
 * Frontend MIRROR of `localWallClockOf` in `backend/src/utils/timezone.ts`,
 * following the same backend/frontend mirror convention as `shared/domains.ts`.
 *
 * The overview tab buckets flights by year, month and weekday in the browser,
 * so it needs the same answer the server gives: the clock at the DEPARTURE
 * airport, not the viewer's own timezone and not the UTC instant (#266). A
 * 07:00 Berlin departure is a morning flight for everyone looking at it,
 * including a reader in Los Angeles.
 */

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

/**
 * Formatters are cached per timezone: building one costs far more than using
 * it, and the overview reads the clock for every flight on every recompute.
 * `null` marks a timezone the runtime rejected, so an unusable string is not
 * re-tried on each row.
 */
const wallClockFormatters = new Map<string, Intl.DateTimeFormat | null>();

function wallClockFormatter(timezone: string): Intl.DateTimeFormat | null {
  const cached = wallClockFormatters.get(timezone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    // en-CA formats as YYYY-MM-DD; h23 keeps midnight at 0 rather than 24.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = null;
  }
  wallClockFormatters.set(timezone, formatter);
  return formatter;
}

/** The components on the clock in `timezone`, or null if it is unusable. */
function zonedComponents(stored: Date, timezone: string): Components | null {
  const formatter = wallClockFormatter(timezone);
  if (!formatter) return null;
  try {
    const parts = formatter.formatToParts(stored);
    const partValue = (type: Intl.DateTimeFormatPartTypes): number =>
      Number.parseInt(parts.find((p) => p.type === type)?.value ?? "x", 10);
    const components = {
      year: partValue("year"),
      month: partValue("month"),
      day: partValue("day"),
      hour: partValue("hour"),
    };
    const complete = Object.values(components).every((v) => Number.isFinite(v));
    return complete ? components : null;
  } catch {
    return null;
  }
}

/**
 * Read a stored flight time as the wall clock at its airport.
 *
 * Which conversion applies depends on the row's storage semantics:
 *   - 'UTC' / 'DATE_ONLY' / 'UNKNOWN': the stored value is a real instant and
 *     is converted through the airport's timezone. UNKNOWN belongs here
 *     deliberately — treating it as legacy would shift the API-imported
 *     real-UTC rows that make up most of the untagged set.
 *   - 'LEGACY_FAKE_UTC': the stored components ARE the wall clock, encoded as
 *     UTC. Converting them would subtract the offset a second time.
 * Without a timezone the stored components are the best available reading.
 *
 * DATE_ONLY rows carry a 12:00 placeholder, so `hour` is null for them: the
 * date is real, the time is not.
 */
export function localWallClockOf(
  stored: Date,
  timezone: string | null | undefined,
  semantics: FlightTimeSemantics = "UNKNOWN",
): LocalWallClock {
  const useStored = semantics === "LEGACY_FAKE_UTC" || !timezone;
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

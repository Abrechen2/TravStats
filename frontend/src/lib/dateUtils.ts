import { formatDate, formatDateTime, formatTime } from "./displayFormat";

const FALLBACK = "—";

function toDate(input: Date | string): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The user's format (Settings → Display) in `timezone`, or in UTC when the zone
 * name is not one Intl knows. These helpers were hard-wired to de-DE, so an
 * English reader with MM/DD/YYYY and a 12h clock saw 14.05.2024, 14:30.
 */
function inZone(timezone: string, write: (zone: string) => string): string {
  try {
    return write(timezone);
  } catch {
    return write("UTC");
  }
}

/**
 * Format a date in the user's date format, in the given timezone.
 */
export function formatDateInTimezone(input: Date | string, timezone: string): string {
  const date = toDate(input);
  if (!date) return FALLBACK;
  return inZone(timezone, (timeZone) => formatDate(date, { timeZone }));
}

export type TimeSemantics = "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";

/**
 * Format a date+time in the user's date and clock format, in the given timezone.
 *
 * When `semantics === 'DATE_ONLY'` the time component is a placeholder
 * (typically 12:00 noon-local) that would mislead the reader, so the
 * function falls back to date-only formatting.
 */
export function formatDateTimeInTimezone(
  input: Date | string,
  timezone: string,
  semantics?: TimeSemantics
): string {
  const date = toDate(input);
  if (!date) return FALLBACK;
  if (semantics === "DATE_ONLY") {
    return inZone(timezone, (timeZone) => formatDate(date, { timeZone }));
  }
  return inZone(timezone, (timeZone) => formatDateTime(date, { timeZone }));
}

/**
 * Format a time-only on the user's clock (24h / 12h), in the given timezone.
 *
 * When `semantics === 'DATE_ONLY'` returns the fallback marker `"—"` —
 * a date-only row has no meaningful time component to render.
 */
export function formatTimeInTimezone(
  input: Date | string,
  timezone: string,
  semantics?: TimeSemantics
): string {
  if (semantics === "DATE_ONLY") return FALLBACK;
  const date = toDate(input);
  if (!date) return FALLBACK;
  return inZone(timezone, (timeZone) => formatTime(date, { timeZone }));
}

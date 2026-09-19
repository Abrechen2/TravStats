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

/**
 * The date as a table shows it: `YYYY-MM-DD`, in the given zone.
 *
 * Round-4 decision E7 — ISO in tables, `DD.MM.YYYY` in prose. The four
 * logbooks printed four forms side by side ("Do 14.01.27", "2023-06-01",
 * "14.01.2027", "14.1.2027"; CT106 audit B11), and a localised date neither
 * sorts by eye nor stays put when the language changes.
 */
export function formatIsoDate(input: Date | string, timezone = "UTC"): string {
  const date = toDate(input);
  if (!date) return FALLBACK;
  const parts = (tz: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).formatToParts(date);
  let fields: Intl.DateTimeFormatPart[];
  try {
    fields = parts(timezone);
  } catch {
    fields = parts("UTC");
  }
  const get = (type: string): string => fields.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

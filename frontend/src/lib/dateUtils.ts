const FALLBACK = "—";

function toDate(input: Date | string): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function formatWith(
  date: Date,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone">,
  timezone: string
): string {
  try {
    return new Intl.DateTimeFormat("de-DE", { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("de-DE", { ...options, timeZone: "UTC" }).format(date);
  }
}

/**
 * Format a date as "dd.MM.yyyy" in the given timezone.
 */
export function formatDateInTimezone(input: Date | string, timezone: string): string {
  const date = toDate(input);
  if (!date) return FALLBACK;
  return formatWith(date, { year: "numeric", month: "2-digit", day: "2-digit" }, timezone);
}

export type TimeSemantics = "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";

/**
 * Format a date+time as "dd.MM.yyyy, HH:mm" in the given timezone.
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
    return formatWith(date, { year: "numeric", month: "2-digit", day: "2-digit" }, timezone);
  }
  return formatWith(
    date,
    { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
    timezone
  );
}

/**
 * Format a time-only as "HH:mm" in the given timezone.
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
  return formatWith(date, { hour: "2-digit", minute: "2-digit" }, timezone);
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

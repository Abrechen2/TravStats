import { useMemo } from "react";

import { displayParts, type LocalDateValue, type TimeValue } from "../shared/time";
import { useSettingsStore, type DisplaySettings } from "../store/settingsStore";
import { appLocale, convertDistance, formatAmount, type DistanceUnit } from "./units";
import { todayZoneNow } from "../hooks/useTodayZone";

/**
 * Dates and times on screen, in the format the user chose.
 *
 * Settings → Display has offered a date format (DD.MM.YYYY, MM/DD/YYYY,
 * YYYY-MM-DD) and a clock (24h / 12h) for a long time, and nothing read
 * either. Every component formatted on its own: the flight table printed
 * "Fr 02.10.26" in a format the settings do not even list, other places
 * followed the browser's locale, and a user on 12h still saw 14:05 (reported
 * by a tester, 2026-09-17). This is the one place that turns an instant into
 * text. Components use `useDisplayFormat()`; plain library code, which cannot
 * call a hook, uses the non-reactive `formatDate` / `formatTime`.
 *
 * The rule for callers: anything that names a DAY follows the setting, even
 * where it used to print a month name ("02. Okt. 2026" is 02.10.2026 now).
 * What stays outside, on purpose: labels without a day ("Mai 2024") and
 * written-out headings ("Freitag, 2. Oktober 2026"), which are prose in the
 * UI language rather than a date format anyone picked.
 */

export type DateFormatPreference = DisplaySettings["dateFormat"];
export type TimeFormatPreference = DisplaySettings["timeFormat"];

export interface DisplayFormatPrefs {
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
}

export interface FormatOptions {
  /**
   * IANA zone the instant is shown in. Omitted: the user's PROFILE zone (UTC
   * until confirmed, ADR 0002 Q1) — never the browser's, which is where the
   * reader happens to sit, not a zone anyone chose. A time at a PLACE never
   * comes here without its zone: it is `local`, see `formatTimeValueWith`.
   */
  timeZone?: string;
  /** Prefix the short weekday name, in the UI language ("Fr 02.10.2026"). */
  weekday?: boolean;
  /**
   * Two-digit year for dense tables ("02.10.26"). Ignored for YYYY-MM-DD:
   * "26-10-02" reads as a different date.
   */
  shortYear?: boolean;
  /** Day and month only, in the chosen order ("02.10." / "10/02" / "10-02"). */
  omitYear?: boolean;
  /** UI language for the weekday name. */
  language?: string;
}

type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The zone a value is read in. A bare `YYYY-MM-DD` is a calendar day, not an
 * instant: `new Date("2026-05-01")` is UTC midnight, so it is read in UTC —
 * in any other zone west of UTC it was the day before. Anything else is an
 * instant, shown in the caller's zone or the profile zone.
 */
function zoneFor(input: DateInput, options: FormatOptions): string {
  if (typeof input === "string" && BARE_DAY.test(input)) return "UTC";
  return options.timeZone ?? todayZoneNow();
}

function calendarParts(date: Date, timeZone?: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "02.10.2026" / "10/02/2026" / "2026-10-02", optionally with weekday. Empty for an invalid date. */
export function formatDateWith(
  prefs: DisplayFormatPrefs,
  input: DateInput,
  options: FormatOptions = {}
): string {
  const date = toDate(input);
  if (!date) return "";
  const timeZone = zoneFor(input, options);
  const { y, m, d } = calendarParts(date, timeZone);
  const year = options.shortYear && prefs.dateFormat !== "YYYY-MM-DD" ? y.slice(-2) : y;
  const core = options.omitYear
    ? prefs.dateFormat === "MM/DD/YYYY"
      ? `${m}/${d}`
      : prefs.dateFormat === "YYYY-MM-DD"
        ? `${m}-${d}`
        : `${d}.${m}.`
    : prefs.dateFormat === "MM/DD/YYYY"
      ? `${m}/${d}/${year}`
      : prefs.dateFormat === "YYYY-MM-DD"
        ? `${year}-${m}-${d}`
        : `${d}.${m}.${year}`;
  if (!options.weekday) return core;
  const weekday = new Intl.DateTimeFormat(options.language ?? "en", {
    weekday: "short",
    timeZone,
  })
    .format(date)
    .replace(/\.$/, "");
  return `${weekday} ${core}`;
}

/** "14:05" on a 24h clock, "2:05 PM" on 12h. Empty for an invalid date. */
export function formatTimeWith(
  prefs: DisplayFormatPrefs,
  input: DateInput,
  options: FormatOptions = {}
): string {
  const date = toDate(input);
  if (!date) return "";
  const timeZone = zoneFor(input, options);
  return prefs.timeFormat === "12h"
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone,
      }).format(date)
    : new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone,
      }).format(date);
}

export function formatDateTimeWith(
  prefs: DisplayFormatPrefs,
  input: DateInput,
  options: FormatOptions = {}
): string {
  const day = formatDateWith(prefs, input, options);
  return day ? `${day} ${formatTimeWith(prefs, input, options)}` : "";
}

/**
 * A PLACE's day, from a `YYYY-MM-DD…` string (a `TimeValue.local`, a
 * `LocalDateValue.date`), in the user's format. The components are placed on
 * a UTC instant and read back in UTC, so neither the reader's zone nor any
 * zone name can move the day (ADR 0002, D3: display `local` as it is).
 */
export function formatLocalDateWith(
  prefs: DisplayFormatPrefs,
  local: string,
  options: Omit<FormatOptions, "timeZone"> = {}
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(local);
  if (!m) return "";
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return formatDateWith(prefs, at, { ...options, timeZone: "UTC" });
}

/** A place's clock (`HH:mm` or a `…THH:mm…` wall clock) on the user's 24h/12h clock. */
export function formatLocalClockWith(prefs: DisplayFormatPrefs, local: string): string {
  const m = /(?:^|T)(\d{2}):(\d{2})/.exec(local);
  if (!m) return "";
  return formatTimeWith(prefs, Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])), {
    timeZone: "UTC",
  });
}

/**
 * A `TimeValue` as the place saw it, cut to its precision: the date, plus
 * the clock when the value knows its time of day. `dateOnly` drops the clock.
 */
export function formatTimeValueWith(
  prefs: DisplayFormatPrefs,
  value: TimeValue,
  options: Omit<FormatOptions, "timeZone"> & { dateOnly?: boolean } = {}
): string {
  const parts = displayParts(value);
  if (!parts) return value.local;
  const { dateOnly, ...dateOptions } = options;
  const day =
    parts.date.length === 10 ? formatLocalDateWith(prefs, parts.date, dateOptions) : parts.date;
  return parts.time && !dateOnly ? `${day} ${formatLocalClockWith(prefs, parts.time)}` : day;
}

/**
 * A `LocalDateValue` cut to its precision. A day follows the user's format; a
 * value known only to the month or the year is written as such, in the UI
 * language ("Juni 2030", "2030") — its stored day is a placeholder, and
 * printing it would name a day nobody knows.
 */
export function formatLocalDateValueWith(
  prefs: DisplayFormatPrefs,
  value: LocalDateValue,
  options: Omit<FormatOptions, "timeZone"> = {}
): string {
  if (value.precision !== "month" && value.precision !== "year") {
    return formatLocalDateWith(prefs, value.date, options);
  }
  const m = /^(\d{4})-(\d{2})/.exec(value.date);
  if (!m) return value.date;
  const parts: Intl.DateTimeFormatOptions =
    value.precision === "month" ? { month: "long", year: "numeric" } : { year: "numeric" };
  return new Intl.DateTimeFormat(options.language ?? "en", { ...parts, timeZone: "UTC" }).format(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)
  );
}

/** The preference as the store holds it right now — for code that cannot use a hook. */
export function currentDisplayFormat(): DisplayFormatPrefs {
  const display = useSettingsStore.getState?.().display;
  return {
    dateFormat: display?.dateFormat ?? "DD.MM.YYYY",
    timeFormat: display?.timeFormat ?? "24h",
  };
}

export const formatDate = (input: DateInput, options?: FormatOptions): string =>
  formatDateWith(currentDisplayFormat(), input, options);
export const formatTime = (input: DateInput, options?: FormatOptions): string =>
  formatTimeWith(currentDisplayFormat(), input, options);
export const formatDateTime = (input: DateInput, options?: FormatOptions): string =>
  formatDateTimeWith(currentDisplayFormat(), input, options);

export interface DisplayFormatter {
  date: (input: DateInput, options?: FormatOptions) => string;
  time: (input: DateInput, options?: FormatOptions) => string;
  dateTime: (input: DateInput, options?: FormatOptions) => string;
  /** A place's day (`YYYY-MM-DD…`), never moved by the reader's zone. */
  localDate: (local: string, options?: Omit<FormatOptions, "timeZone">) => string;
  /** A place's day as a `LocalDateValue`, cut to its precision. */
  localDateValue: (value: LocalDateValue) => string;
  /** A place's clock (`HH:mm` / `…THH:mm`). */
  localClock: (local: string) => string;
  /** A `TimeValue` as the place saw it, cut to its precision. */
  timeValue: (
    value: TimeValue,
    options?: Omit<FormatOptions, "timeZone"> & { dateOnly?: boolean }
  ) => string;
}

/** The formatters, re-rendering the component when the user changes the setting. */
export function useDisplayFormat(): DisplayFormatter {
  const dateFormat = useSettingsStore((s) => s.display.dateFormat);
  const timeFormat = useSettingsStore((s) => s.display.timeFormat);
  const language = useSettingsStore((s) => s.display.language);
  return useMemo(() => {
    const prefs = { dateFormat, timeFormat };
    const withLanguage = (options?: FormatOptions): FormatOptions => ({
      language: language === "de" ? "de" : "en",
      ...options,
    });
    return {
      date: (input, options) => formatDateWith(prefs, input, withLanguage(options)),
      time: (input, options) => formatTimeWith(prefs, input, withLanguage(options)),
      dateTime: (input, options) => formatDateTimeWith(prefs, input, withLanguage(options)),
      localDate: (local, options) =>
        formatLocalDateWith(prefs, local, withLanguage(options) as Omit<FormatOptions, "timeZone">),
      localDateValue: (value) =>
        formatLocalDateValueWith(prefs, value, { language: language === "de" ? "de" : "en" }),
      localClock: (local) => formatLocalClockWith(prefs, local),
      timeValue: (value, options) =>
        formatTimeValueWith(prefs, value, {
          language: language === "de" ? "de" : "en",
          ...options,
        }),
    };
  }, [dateFormat, timeFormat, language]);
}

export const formatLocalDate = (local: string, options?: Omit<FormatOptions, "timeZone">): string =>
  formatLocalDateWith(currentDisplayFormat(), local, options);
export const formatLocalClock = (local: string): string =>
  formatLocalClockWith(currentDisplayFormat(), local);
export const formatTimeValueShown = (
  value: TimeValue,
  options?: Omit<FormatOptions, "timeZone"> & { dateOnly?: boolean }
): string => formatTimeValueWith(currentDisplayFormat(), value, options);

// ─── Duration, distance, money, day labels ────────────────────────────────
//
// rc.47: one home for the formatters that used to be copied per file (seven
// `formatDate`, six `formatKm`, five `formatDuration`, three `formatDistance`,
// a `formatMoney`, plus bare `toLocale*String` calls). A source scan
// (`__tests__/lint/noLocalFormatters.test.ts`) refuses a new local copy. The
// number/currency primitives stay in `units.ts` and are re-exported here, so a
// caller needs only this module.

export {
  formatAmount,
  formatCurrency,
  formatDistance,
  formatHours,
  formatNumber,
  formatShortDistance,
} from "./units";

/**
 * A duration in minutes, as the design writes it: "2 h 05 min", "45 min",
 * "2 h". With `days`, anything of 48 hours or more reads "3 T 4 h" in German
 * and "3 d 4 h" in English — a recording of several days is not "51 h". The
 * language is the app's unless given; only the day letter differs.
 */
export function formatDuration(
  minutes: number,
  options: { days?: boolean; language?: string } = {}
): string {
  if (!Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (options.days && h >= 48) {
    const dayLetter = appLocale(options.language).startsWith("de") ? "T" : "d";
    return `${Math.floor(h / 24)} ${dayLetter} ${h % 24} h`;
  }
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/**
 * Same as `formatDuration` but prefixes a `~` when the value is an
 * estimate (e.g. great-circle-based for DATE_ONLY rows). Returns the
 * fallback marker `"—"` when minutes is null.
 */
export function formatDurationWithEstimate(
  minutes: number | null | undefined,
  estimated: boolean
): string {
  if (minutes == null) return "—";
  const base = formatDuration(minutes);
  return estimated ? `~${base}` : base;
}

const UNIT_SUFFIX: Record<DistanceUnit, string> = {
  kilometers: "km",
  miles: "mi",
  nautical_miles: "nm",
};

export interface FormatKmOptions {
  /** Default: the unit chosen in Settings → Display. */
  unit?: DistanceUnit;
  /** Default: the language the app is speaking. */
  language?: string;
  /** Digits after the separator; default 0 (whole units). */
  fractionDigits?: number;
}

/**
 * A distance given in KILOMETRES, shown in the reader's unit and language:
 * "3.931 km" for a German reader, "2,442 mi" for an English one on miles. The
 * source value is always km; the unit setting decides what is shown. `null`
 * (distance unknown) is "—", never "0".
 */
export function formatKm(km: number | null | undefined, options: FormatKmOptions = {}): string {
  if (km == null || Number.isNaN(km)) return "—";
  const unit = options.unit ?? currentDistanceUnit();
  const digits = options.fractionDigits ?? 0;
  const value = convertDistance(km, unit).toLocaleString(appLocale(options.language), {
    maximumFractionDigits: digits,
  });
  return `${value} ${UNIT_SUFFIX[unit]}`;
}

/**
 * A short distance given in METRES, in the reader's unit: "350 m" below a
 * kilometre on the metric setting, otherwise one decimal ("1.4 km", "0.9 mi").
 */
export function formatMetres(
  metres: number | null | undefined,
  options: Omit<FormatKmOptions, "fractionDigits"> = {}
): string {
  if (metres == null || Number.isNaN(metres)) return "";
  const unit = options.unit ?? currentDistanceUnit();
  if (unit === "kilometers" && metres < 1000) {
    return `${Math.round(metres).toLocaleString(appLocale(options.language))} m`;
  }
  return formatKm(metres / 1000, { ...options, unit, fractionDigits: 1 });
}

function currentDistanceUnit(): DistanceUnit {
  return useSettingsStore.getState?.().units?.distanceUnit ?? "kilometers";
}

/**
 * An amount in a currency, "—" when the amount is unknown. A missing currency
 * gives a bare number (`formatAmount`), never a guessed euro.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options?: { compact?: boolean; language?: string }
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return formatAmount(amount, currency, options);
}

/**
 * A calendar DAY (`YYYY-MM-DD`, or an ISO string cut to its first ten
 * characters) as prose in the UI language: "Mai 2024", "3. Mai". For labels
 * that are not a date format anybody picked (see the header). The day is
 * read as UTC so the browser's zone cannot move it.
 */
export function formatDayLabel(
  day: string,
  options: Intl.DateTimeFormatOptions,
  language?: string
): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(appLocale(language), { ...options, timeZone: "UTC" });
}

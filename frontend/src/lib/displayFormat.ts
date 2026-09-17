import { useMemo } from "react";

import { useSettingsStore, type DisplaySettings } from "../store/settingsStore";

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
  /** IANA zone the instant is shown in; the viewer's own zone when omitted. */
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
  const { y, m, d } = calendarParts(date, options.timeZone);
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
    timeZone: options.timeZone,
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
  return prefs.timeFormat === "12h"
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: options.timeZone,
      }).format(date)
    : new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: options.timeZone,
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
    };
  }, [dateFormat, timeFormat, language]);
}

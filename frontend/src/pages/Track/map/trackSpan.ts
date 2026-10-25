import {
  addDays,
  dayParts,
  dayString,
  daysBetween,
  daysInMonth,
} from "../../../shared/time/calendar";
import type { TrackRange } from "./trackRange";

/**
 * The span the Track map shows, every kind of it (TravTrack plan T5.2 + T5.3):
 * a day and seven days are composed from day reads (`trackRange.ts`); a
 * month, a year and a picked span ("Zeitraum") come from the server's range
 * read in parts. The URL keeps `/track/:date` as the span's last day, so a day
 * link keeps working:
 *
 *   /track, /track/:date            one day
 *   /track/:date?range=7            seven days ending at :date
 *   /track/:date?range=month        the month of :date (up to today)
 *   /track/:date?range=year         the year of :date (up to today)
 *   /track/:date?range=custom&from= from `from` to :date
 */

export type SpanKind = "day" | "week" | "month" | "year" | "custom";

export interface TrackSpan {
  kind: SpanKind;
  /** First day shown, on the profile's clock. */
  fromDay: string;
  /** Last day shown. */
  toDay: string;
}

export type SpanPreset = "today" | "yesterday" | "week" | "month" | "year" | "custom";

/** Days a range read may cover (the server's `TRAVTRACK_RANGE_MAX_DAYS`). */
export const RANGE_MAX_DAYS = 400;
/** The longest span the replay plays and the photo layer asks for. */
export const REPLAY_MAX_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const minDay = (a: string, b: string) => (a < b ? a : b);

const monthStart = (day: string) => {
  const { year, month } = dayParts(day);
  return dayString(year, month, 1);
};
const monthEnd = (day: string) => {
  const { year, month } = dayParts(day);
  return dayString(year, month, daysInMonth(year, month));
};
const yearStart = (day: string) => dayString(dayParts(day).year, 1, 1);
const yearEnd = (day: string) => dayString(dayParts(day).year, 12, 31);

/** The days a span names, both ends counted. */
export const spanDays = (span: Pick<TrackSpan, "fromDay" | "toDay">): number =>
  daysBetween(span.fromDay, span.toDay) + 1;

/** Whether the span is read through the server's range read (not composed from day reads). */
export const isLongSpan = (span: TrackSpan): boolean =>
  span.kind === "month" || span.kind === "year" || span.kind === "custom";

/** The day-read range of a day or week span. */
export const dayRangeOf = (span: TrackSpan): TrackRange => ({
  end: span.toDay,
  length: span.kind === "week" ? 7 : 1,
});

/** A month or year span around `day`, ending no later than today. */
function calendarSpan(kind: "month" | "year", day: string, today: string): TrackSpan {
  const from = kind === "month" ? monthStart(day) : yearStart(day);
  const to = kind === "month" ? monthEnd(day) : yearEnd(day);
  return { kind, fromDay: from, toDay: minDay(to, today) };
}

/** Reads the span from the URL; anything unreadable falls back to one day. */
export function parseSpan(
  date: string | undefined,
  search: URLSearchParams,
  today: string
): TrackSpan {
  const end = date && DAY.test(date) ? minDay(date, today) : today;
  const range = search.get("range");
  if (range === "7") return { kind: "week", fromDay: addDays(end, -6), toDay: end };
  if (range === "month" || range === "year") return calendarSpan(range, end, today);
  if (range === "custom") {
    const from = search.get("from");
    if (from && DAY.test(from)) {
      // A span picked backwards is the same span.
      return from <= end
        ? { kind: "custom", fromDay: from, toDay: end }
        : { kind: "custom", fromDay: end, toDay: minDay(from, today) };
    }
  }
  return { kind: "day", fromDay: end, toDay: end };
}

/** The URL a span lives at. */
export function spanPath(span: TrackSpan, today: string): string {
  switch (span.kind) {
    case "day":
      return span.toDay === today ? "/track" : `/track/${span.toDay}`;
    case "week":
      return `/track/${span.toDay}?range=7`;
    case "month":
    case "year":
      return `/track/${span.toDay}?range=${span.kind}`;
    case "custom":
      return `/track/${span.toDay}?range=custom&from=${span.fromDay}`;
  }
}

/** One step back or forward by the span's own size: a month by a month, a year by a year. */
export function stepSpan(span: TrackSpan, direction: -1 | 1, today: string): TrackSpan {
  switch (span.kind) {
    case "day":
    case "week": {
      const n = direction * spanDays(span);
      return { ...span, fromDay: addDays(span.fromDay, n), toDay: addDays(span.toDay, n) };
    }
    case "month": {
      const { year, month } = dayParts(span.fromDay);
      return calendarSpan("month", dayString(year, month + direction, 1), today);
    }
    case "year":
      return calendarSpan("year", dayString(dayParts(span.fromDay).year + direction, 1, 1), today);
    case "custom": {
      const n = direction * spanDays(span);
      return { kind: "custom", fromDay: addDays(span.fromDay, n), toDay: addDays(span.toDay, n) };
    }
  }
}

/** Whether a step forward would only show days after today. */
export const atPresent = (span: TrackSpan, today: string): boolean => span.toDay >= today;

export function presetSpan(preset: SpanPreset, today: string, current: TrackSpan): TrackSpan {
  switch (preset) {
    case "today":
      return { kind: "day", fromDay: today, toDay: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { kind: "day", fromDay: day, toDay: day };
    }
    case "week":
      return { kind: "week", fromDay: addDays(current.toDay, -6), toDay: current.toDay };
    case "month":
      return calendarSpan("month", current.toDay, today);
    case "year":
      return calendarSpan("year", current.toDay, today);
    case "custom":
      return { kind: "custom", fromDay: current.fromDay, toDay: current.toDay };
  }
}

/** Which preset the span is, if any — a day picked by hand is none. */
export function activeSpanPreset(span: TrackSpan, today: string): SpanPreset | null {
  if (span.kind === "day") {
    if (span.toDay === today) return "today";
    if (span.toDay === addDays(today, -1)) return "yesterday";
    return null;
  }
  return span.kind;
}

/** A Zeitraum picked from two days, in order, never past today. */
export function customSpan(fromDay: string, toDay: string, today: string): TrackSpan {
  const [a, b] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
  return { kind: "custom", fromDay: minDay(a, today), toDay: minDay(b, today) };
}

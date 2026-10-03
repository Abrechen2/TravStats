import type { TimeValue } from "../../shared/time/wire";

/**
 * Bilingual display helpers for reminder emails (ADR 0002 phase 4 consumer).
 *
 * Reminder emails are plain server-rendered HTML, not react-i18next, so they
 * carry their own tiny DE/EN copy rather than a second i18n system. Every
 * time value shown here is already resolved to a place's local wall clock
 * upstream (`shared/time/wire.ts` `TimeValue`, built by each domain's
 * `timesDto.ts`) — this module only FORMATS that string for display. It never
 * reads a Date's host-zone getters and never calls a zoned formatter without
 * an explicit `timeZone`, so it needs no exemption from the time-model lint
 * rules (`scripts/eslint/timeRules.mjs`).
 */

export type ReminderLang = "de" | "en";

const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** `TimeValue.local` is always `YYYY-MM-DDTHH:mm:ss` (shared/time/wire.ts) — pure string parsing. */
function parseLocal(local: string): LocalParts {
  const [datePart, timePart] = local.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return { year, month, day, hour, minute };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

const WEEKDAYS: Record<ReminderLang, readonly string[]> = {
  de: ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/**
 * "So., 27.09.2026" / "Sun, Sep 27, 2026". The weekday is pure calendar
 * arithmetic on a UTC anchor: the date is already the place's own day, so no
 * zone — the host's least of all — takes part here.
 */
function datePhrase(year: number, month: number, day: number, lang: ReminderLang): string {
  const wd = WEEKDAYS[lang][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return lang === "de"
    ? `${wd}, ${pad2(day)}.${pad2(month)}.${year}`
    : `${wd}, ${EN_MONTHS[month - 1]} ${day}, ${year}`;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar day (`YYYY-MM-DD`, e.g. `LocalDateValue.date`) as the mail shows
 * it. Null for anything that is not a full date — the caller leaves the row
 * out rather than printing a raw or half-known value.
 */
export function formatLocalDate(
  date: string | null | undefined,
  lang: ReminderLang
): string | null {
  const match = date ? LOCAL_DATE.exec(date) : null;
  if (!match) return null;
  return datePhrase(Number(match[1]), Number(match[2]), Number(match[3]), lang);
}

/**
 * A `TimeValue`'s wall clock as the reminder email shows it, DE or EN. Never
 * UTC unless the value itself carries no zone (`zone: null`), in which case
 * the UTC reading is shown labelled as UTC rather than passed off as the
 * place's clock — the same rule `shared/time` documents for every reader.
 *
 * The precision is honoured: a DAY-precision value is stored at the start of
 * its day, so printing its clock would announce a "00:00" nobody booked — it
 * goes out as the date alone. Anything coarser has no day to name and is left
 * out (null).
 */
export function formatTimeValue(
  tv: TimeValue | null | undefined,
  lang: ReminderLang
): string | null {
  if (!tv) return null;
  if (tv.precision !== "minute" && tv.precision !== "day") return null;
  const p = parseLocal(tv.local);
  const date = datePhrase(p.year, p.month, p.day, lang);
  if (tv.precision === "day") return date;
  const suffix = tv.zone === null ? " (UTC)" : "";
  if (lang === "de") {
    return `${date}, ${pad2(p.hour)}:${pad2(p.minute)} Uhr${suffix}`;
  }
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return `${date}, ${hour12}:${pad2(p.minute)} ${ampm}${suffix}`;
}

/** "in 24 hours" / "in 2 hours" — the only two windows the scheduler uses today, phrased naturally. */
export function formatHoursUntil(hours: number, lang: ReminderLang): string {
  if (lang === "de") {
    return `in ${hours} Stunde${hours === 1 ? "" : "n"}`;
  }
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** A flight/journey duration in minutes, phrased naturally ("2 Std. 15 Min." / "2h 15m"). */
export function formatDurationMinutes(minutes: number | null, lang: ReminderLang): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (lang === "de") {
    return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Escapes text interpolated into the reminder HTML — booking data is parser/import sourced, never trusted. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

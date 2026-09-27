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

/**
 * A `TimeValue`'s wall clock as the reminder email shows it, DE or EN. Never
 * UTC unless the value itself carries no zone (`zone: null`), in which case
 * the UTC reading is shown labelled as UTC rather than passed off as the
 * place's clock — the same rule `shared/time` documents for every reader.
 */
export function formatTimeValue(
  tv: TimeValue | null | undefined,
  lang: ReminderLang
): string | null {
  if (!tv) return null;
  const p = parseLocal(tv.local);
  const suffix = tv.zone === null ? (lang === "de" ? " (UTC)" : " (UTC)") : "";
  if (lang === "de") {
    return `${pad2(p.day)}.${pad2(p.month)}.${p.year}, ${pad2(p.hour)}:${pad2(p.minute)} Uhr${suffix}`;
  }
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return `${EN_MONTHS[p.month - 1]} ${p.day}, ${p.year}, ${hour12}:${pad2(p.minute)} ${ampm}${suffix}`;
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

import { formatInTimeZone } from "date-fns-tz";

import { calculateDistance } from "../../../utils/geo";

/**
 * Small, provider-independent rules the lookup shares: reading a train number
 * and deciding whether a timetable entry is the train and the day asked for.
 */

/**
 * "ICE 578" → { category: "ICE", number: "578" }; "578" → no category;
 * "TGV 9876/9877" → the first number. Null when there is no number at all.
 */
export function parseTrainNumber(
  raw: string,
  category?: string | null
): { number: string; category: string | null } | null {
  const text = raw.trim();
  const digits = /(\d{1,6})/.exec(text);
  if (!digits) return null;
  const letters = /^([A-Za-z]{1,6})\b/.exec(text)?.[1] ?? category?.trim() ?? null;
  return {
    number: String(Number(digits[1])),
    category: letters ? letters.toUpperCase() : null,
  };
}

/**
 * Whether a timetable label ("ICE 696", "9586", "IC 2441") is the train asked
 * for. The number must be a whole token — 578 is not 1578 — and a category,
 * when asked for, must appear in one of the labels (the SNCF feed labels the
 * same ICE only "9586", its display name "ICE 9586").
 */
export function labelMatches(
  labels: ReadonlyArray<string | null | undefined>,
  number: string,
  category: string | null
): boolean {
  const joined = labels.filter(Boolean).join(" ").toUpperCase();
  const numbers = joined.match(/\d+/g)?.map((n) => String(Number(n))) ?? [];
  if (!numbers.includes(number)) return false;
  if (category === null) return true;
  const letters = category.toUpperCase().replace(/[^A-Z]/g, "");
  return letters === "" || new RegExp(`\\b${letters}\\b`).test(joined);
}

/**
 * Whether an instant falls on `date` on the station's clock. This is the
 * honest-limits guard: asked for a day before its timetable starts,
 * Transitous answers with the first day it HAS (measured 2026-09-25: a query
 * for 2024-06-01 at Frankfurt Hbf came back with trains of 2026-08-25). An
 * answer for another day is no answer.
 */
export function isOnDay(instant: Date, date: string, timezone: string | null): boolean {
  return formatInTimeZone(instant, timezone ?? "UTC", "yyyy-MM-dd") === date;
}

/** Index of the stop nearest a point, and how far it is. */
export function nearestStop(
  stops: ReadonlyArray<{ lat: number; lon: number }>,
  point: { lat: number; lon: number }
): { index: number; km: number } {
  let best = { index: -1, km: Number.POSITIVE_INFINITY };
  stops.forEach((stop, index) => {
    const d = calculateDistance(stop.lat, stop.lon, point.lat, point.lon);
    if (d < best.km) best = { index, km: d };
  });
  return best;
}

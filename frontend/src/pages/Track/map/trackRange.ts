import type { TravTrackDay } from "../../../lib/api/travtrack";
import { addDays } from "../../../shared/time/calendar";

/**
 * The span the Track map shows (TravTrack plan T5.2): one day, or seven days
 * ending at a day — composed client-side from the day reads, because Monat /
 * Jahr / Zeitraum need the server's range read (T5.3). The URL stays
 * `/track/:date`, with `?range=7` for the week, so a day link keeps working.
 */

export type RangeLength = 1 | 7;

export interface TrackRange {
  /** The last day shown, on the profile's clock. */
  end: string;
  length: RangeLength;
}

export type RangePreset = "today" | "yesterday" | "week";

/** The days of a range, oldest first. */
export function rangeDays(range: TrackRange): string[] {
  return Array.from({ length: range.length }, (_, i) => addDays(range.end, i - range.length + 1));
}

/** One step back or forward by the range's own length. */
export function stepRange(range: TrackRange, direction: -1 | 1): TrackRange {
  return { ...range, end: addDays(range.end, direction * range.length) };
}

export function presetRange(preset: RangePreset, today: string, current: TrackRange): TrackRange {
  switch (preset) {
    case "today":
      return { end: today, length: 1 };
    case "yesterday":
      return { end: addDays(today, -1), length: 1 };
    case "week":
      return { end: current.end, length: 7 };
  }
}

/** Which preset the range is, if any — a day picked by hand is none. */
export function activePreset(range: TrackRange, today: string): RangePreset | null {
  if (range.length === 7) return "week";
  if (range.end === today) return "today";
  if (range.end === addDays(today, -1)) return "yesterday";
  return null;
}

/** The URL a range lives at. */
export function rangePath(range: TrackRange, today: string): string {
  if (range.length === 7) return `/track/${range.end}?range=7`;
  return range.end === today ? "/track" : `/track/${range.end}`;
}

export type DayResult =
  | { date: string; kind: "loading" }
  | { date: string; kind: "loaded"; day: TravTrackDay }
  | { date: string; kind: "failed"; key: string };

/** How many day reads run at once — a week is seven requests, not seven at a time. */
export const DAY_READ_CONCURRENCY = 3;

/**
 * Reads every day with at most `limit` requests in flight. Each day answers
 * for itself: one that fails is a failed day with its reason, never an empty
 * day, and never takes the others down. `onResult` hears each day as it lands.
 */
export async function readDays(
  days: readonly string[],
  read: (date: string) => Promise<TravTrackDay>,
  errorKey: (err: unknown) => string,
  onResult: (result: DayResult) => void = () => undefined,
  limit = DAY_READ_CONCURRENCY
): Promise<DayResult[]> {
  const results: DayResult[] = days.map((date) => ({ date, kind: "loading" }));
  let next = 0;
  const worker = async () => {
    while (next < days.length) {
      const index = next++;
      const date = days[index];
      let result: DayResult;
      try {
        result = { date, kind: "loaded", day: await read(date) };
      } catch (err: unknown) {
        result = { date, kind: "failed", key: errorKey(err) };
      }
      results[index] = result;
      onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, days.length) }, worker));
  return results;
}

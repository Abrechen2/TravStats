import type { DawarichClient, DawarichPoint } from "../../dawarich/dawarichClient";
import { DawarichError } from "../../dawarich/errors";

/**
 * Reading a span of an account's Dawarich history for the copy into TravTrack
 * (TravTrack plan L6). Only `getPoints` is ever called — a GET; nothing here
 * writes to Dawarich.
 *
 * A span (at most a month) is read in one window; when Dawarich has more than
 * the client collects (`truncated`), each day is read on its own, and a day
 * that is still truncated is halved at hour boundaries down to one hour. An
 * hour that is still truncated is named in `truncatedHours` — its newest slice
 * is copied, and the copy ends `incomplete` rather than pretending it is whole.
 *
 * Dawarich reads `start_at`/`end_at` inclusively and in whole seconds, so a
 * window `[from, to)` asks for `[from, to − 1 s]`: a fix at midnight belongs to
 * the day it starts, never to two.
 *
 * A `protocol` answer (Dawarich answered, but not with points) for a span falls
 * back to its days; for a single day, the day is named in `unreachable` and the
 * copy goes on. Every other Dawarich failure — down, a refused key — is thrown:
 * the copy pauses with its checkpoint kept.
 */

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const hourKey = (ms: number): string => `${new Date(ms).toISOString().slice(0, 13)}:00Z`;

/** What one UTC day of the history held. */
export type DayHarvest = {
  day: string;
  startMs: number;
  points: DawarichPoint[];
  /** Rows Dawarich sent without a usable id, position or time. */
  unusable: number;
  /** Hours still truncated after subdivision, `YYYY-MM-DDTHH:00Z`. */
  truncatedHours: string[];
  /** Dawarich did not answer this day with points. */
  unreachable: boolean;
};

export type ReadDeps = {
  client: DawarichClient;
  /** Runs before every HTTP page: the heartbeat, the pause between requests, the stop check. */
  beforeRequest: () => Promise<void>;
};

type Window = { points: DawarichPoint[]; unusable: number; truncated: boolean };

async function readWindow(deps: ReadDeps, fromMs: number, toMs: number): Promise<Window> {
  // Before every page, not once per window: a window can be 50 requests.
  const result = await deps.client.getPoints({
    startAt: new Date(fromMs),
    endAt: new Date(toMs - 1000),
    beforePage: deps.beforeRequest,
  });
  return {
    // Defensive: never a fix outside the window asked for.
    points: result.points.filter((p) => p.timestampMs >= fromMs && p.timestampMs < toMs),
    unusable: result.unusable ?? 0,
    truncated: result.truncated,
  };
}

/** Hours `[h0, h1)` of the day starting at `dayMs`: halved while truncated, down to one hour. */
async function readHours(
  deps: ReadDeps,
  dayMs: number,
  h0: number,
  h1: number,
  first?: Window
): Promise<Omit<DayHarvest, "day" | "startMs" | "unreachable">> {
  const read = first ?? (await readWindow(deps, dayMs + h0 * HOUR_MS, dayMs + h1 * HOUR_MS));
  if (!read.truncated) return { points: read.points, unusable: read.unusable, truncatedHours: [] };
  if (h1 - h0 === 1) {
    return {
      points: read.points,
      unusable: read.unusable,
      truncatedHours: [hourKey(dayMs + h0 * HOUR_MS)],
    };
  }
  const mid = Math.floor((h0 + h1) / 2);
  const a = await readHours(deps, dayMs, h0, mid);
  const b = await readHours(deps, dayMs, mid, h1);
  return {
    points: [...a.points, ...b.points],
    unusable: a.unusable + b.unusable,
    truncatedHours: [...a.truncatedHours, ...b.truncatedHours],
  };
}

async function readDay(deps: ReadDeps, dayMs: number): Promise<DayHarvest> {
  const base = { day: dayKey(dayMs), startMs: dayMs };
  try {
    return { ...base, ...(await readHours(deps, dayMs, 0, 24)), unreachable: false };
  } catch (err) {
    if (err instanceof DawarichError && err.kind === "protocol") {
      return { ...base, points: [], unusable: 0, truncatedHours: [], unreachable: true };
    }
    throw err;
  }
}

/** Groups a whole window's points by UTC day, oldest first. */
function byDay(read: Window, fromMs: number, toMs: number): DayHarvest[] {
  const days = new Map<number, DawarichPoint[]>();
  // Appended in place: copying a day's array per fix made a dense day
  // quadratic (50,000 fixes ≈ 1.25 billion copied references).
  for (const p of read.points) {
    const start = Math.floor(p.timestampMs / DAY_MS) * DAY_MS;
    const day = days.get(start);
    if (day) day.push(p);
    else days.set(start, [p]);
  }
  const harvest = [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startMs, points]) => ({
      day: dayKey(startMs),
      startMs,
      points,
      unusable: 0,
      truncatedHours: [],
      unreachable: false,
    }));
  // A window's unusable rows carry no time: they are counted on its first day.
  if (read.unusable > 0) {
    const first = harvest[0];
    if (first) first.unusable = read.unusable;
    else
      harvest.push({
        day: dayKey(fromMs),
        startMs: fromMs,
        points: [],
        unusable: read.unusable,
        truncatedHours: [],
        unreachable: false,
      });
  }
  return harvest.filter((d) => d.startMs >= fromMs && d.startMs < toMs);
}

/**
 * The days of `[fromMs, toMs)` (UTC midnights, at most a month) that hold
 * anything to report, oldest first. A day without points is not yielded: the
 * caller's checkpoint passes over it.
 */
export async function* readSpan(
  deps: ReadDeps,
  fromMs: number,
  toMs: number
): AsyncGenerator<DayHarvest> {
  let whole: Window | null = null;
  try {
    whole = await readWindow(deps, fromMs, toMs);
  } catch (err) {
    if (!(err instanceof DawarichError && err.kind === "protocol")) throw err;
  }
  if (whole && !whole.truncated) {
    yield* byDay(whole, fromMs, toMs);
    return;
  }
  for (let day = fromMs; day < toMs; day += DAY_MS) {
    const harvest = await readDay(deps, day);
    if (
      harvest.points.length > 0 ||
      harvest.unusable > 0 ||
      harvest.unreachable ||
      harvest.truncatedHours.length > 0
    ) {
      yield harvest;
    }
  }
}

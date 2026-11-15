// Live-playback time model for the globe's flight arcs (forgejo#352).
//
// The arcs are aggregated ONCE for the whole logbook. Each route keeps the
// sorted departure times of its flights, and the GPU hides what has not been
// flown yet (DataFilterExtension, see `buildGlobeLayers`). A GPU filter hides
// geometry but cannot recount, so every number a person reads — the tooltip's
// count, the stats card's route count — is derived here from the same
// timeline, by binary search, instead of being a stale full-logbook figure.

import type { ArcDatum } from "./globeLayerTypes";

/** Per-route timeline: parallel to `ArcDatum.flightIds` (oldest flight first). */
export interface ArcTimeline {
  /** Departure time (epoch ms) of each flight, ascending. */
  times: number[];
  /** `flown[k]` = flights among the first k that count as flown (length n + 1). */
  flown: number[];
  /** `scheduled[k]` = flights among the first k that are still scheduled (length n + 1). */
  scheduled: number[];
}

/** One flight's contribution while a route is being aggregated. */
export interface TimelineEvent {
  t: number;
  id: string;
  flown: boolean;
  scheduled: boolean;
}

/** Sorts a route's events and builds the prefix tables the datum carries. */
export function buildTimeline(events: TimelineEvent[]): {
  timeline: ArcTimeline;
  flightIds: string[];
} {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const flown: number[] = [0];
  const scheduled: number[] = [0];
  for (const e of sorted) {
    flown.push(flown[flown.length - 1] + (e.flown ? 1 : 0));
    scheduled.push(scheduled[scheduled.length - 1] + (e.scheduled ? 1 : 0));
  }
  return {
    timeline: { times: sorted.map((e) => e.t), flown, scheduled },
    flightIds: sorted.map((e) => e.id),
  };
}

/** How many of the ascending `times` are at or before `t` (upper bound). */
export function countUpTo(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The arc as it stands at `t`: only the flights already flown count, so a
 * hover card says "3 flights" on the day the third one left, not the
 * logbook's total. Arcs without a timeline (recorded lines, non-live data)
 * come back untouched.
 */
export function arcAtTime(arc: ArcDatum, t: number | null): ArcDatum {
  const tl = arc.timeline;
  if (t === null || !tl) return arc;
  const k = countUpTo(tl.times, t);
  if (k === arc.count) return arc;
  // A recorded line stands for ONE flight but quotes its route's count: only the
  // numbers move, the flight it belongs to stays.
  if (arc.recorded) {
    return { ...arc, count: k, flownCount: tl.flown[k], scheduledCount: tl.scheduled[k] };
  }
  return {
    ...arc,
    count: k,
    flightIds: arc.flightIds.slice(0, k),
    flownCount: tl.flown[k],
    scheduledCount: tl.scheduled[k],
    status: k > 0 && tl.scheduled[k] === k ? "scheduled" : "past",
  };
}

/** Routes (recorded lines excluded) that have been flown by `t`. */
export function countVisibleRoutes(arcs: readonly ArcDatum[], t: number): number {
  let n = 0;
  for (const a of arcs) {
    if (a.recorded) continue;
    if (a.visibleFrom === undefined || a.visibleFrom <= t) n++;
  }
  return n;
}

const MINUTE_MS = 60_000;
/**
 * The filter range's open ends. NOT ±Infinity: deck.gl normalises the range
 * on the GPU, and an infinite end turned every arc invisible (found in a
 * production build with 5 000 flights, where the unit tests were green).
 */
export const GPU_MINUTE_FLOOR = -1e9;
export const GPU_MINUTE_CEIL = 1e9;
/** Fixed, so the GPU values of a route never change while the cursor moves. */
export const GPU_TIME_ORIGIN_MS = Date.UTC(2020, 0, 1);

/**
 * deck.gl reads a filter value as a 32-bit float, which holds epoch
 * milliseconds only to ~2 minutes. Minutes since the logbook's first flight
 * stay exact for 31 years either side of 2020, so that is what goes to the GPU. A route appears at
 * the first whole minute at or after its time (ceil), and the cursor is floored,
 * so the GPU never shows an arc earlier than the CPU-side counts do.
 */
export function gpuMinute(t: number, round: "ceil" | "floor"): number {
  const m = (t - GPU_TIME_ORIGIN_MS) / MINUTE_MS;
  return round === "ceil" ? Math.ceil(m) : Math.floor(m);
}

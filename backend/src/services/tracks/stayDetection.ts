import { haversineKm } from "../../shared/geo/haversine";
import type { JitterProfile } from "./jitterProfiles";

/**
 * Where a recording stood still (forgejo#319, pass 3 of `jitterFilter.ts`).
 * Pure; reads a time-ordered, fully timed run of fixes.
 *
 * A stay cannot be found fix by fix. A phone at a gate scatters its fixes
 * tens to hundreds of metres around where it lies, so any single fix may be
 * further from the centre than the next taxiing one. What separates standing
 * from moving is the WINDOW: over `windowMs` around a fix, the centre of the
 * earlier half and the centre of the later half lie on top of each other when
 * the phone stands — the scatter averages out — and lie v · window / 2 apart
 * when it moves at v. A fix is stationary when that displacement stays inside
 * the stay radius (the fixes' own accuracy, never below the profile's floor).
 * So nothing moving faster than 2 · radius / window is ever called a stay;
 * `jitterProfiles.ts` lists that speed per mode.
 *
 * Stationary fixes in a row are a stay; two stays at the same place with a
 * short burst of scatter between them are one; and a stay reaches back and
 * forward to the first and last fix of its window that still lies inside the
 * radius, so the scatter at its edges (arriving, leaving) is not left behind
 * as a zigzag. A stay shorter than the profile's `minStayMs` is not one.
 */

export interface StayFix {
  lon: number;
  lat: number;
  t: number;
  /** The fix's uncertainty in metres, already clamped by the caller. */
  uncertaintyM: number;
}

/** A stay: input positions `[start, end)` and the point that stands for them. */
export interface Stay {
  start: number;
  end: number;
  lon: number;
  lat: number;
}

/**
 * The window never spans fewer than this many of the recording's own
 * sampling steps: a phone fixing every five minutes needs half an hour to
 * say anything about standing still.
 */
export const STAY_WINDOW_STEPS = 6;

type Point = { lon: number; lat: number };

function distanceM(a: Point, b: Point): number {
  return haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) * 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The window: the profile's minimum stay, or `STAY_WINDOW_STEPS` sampling steps. */
export function stayWindowMs(fixes: readonly StayFix[], profile: JitterProfile): number {
  const steps = fixes
    .slice(1)
    .map((f, k) => f.t - fixes[k].t)
    .filter((dt) => dt > 0);
  const typical = steps.length > 0 ? median(steps) : 0;
  return Math.max(profile.minStayMs, STAY_WINDOW_STEPS * typical);
}

/** First index whose time is >= `t` (`fixes` is time-ordered). */
function lowerBound(fixes: readonly StayFix[], t: number): number {
  let lo = 0;
  let hi = fixes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Prefix sums so any range's weighted centre and mean uncertainty cost O(1). */
function prefixSums(fixes: readonly StayFix[]) {
  const n = fixes.length;
  const w = new Float64Array(n + 1);
  const lon = new Float64Array(n + 1);
  const lat = new Float64Array(n + 1);
  const unc = new Float64Array(n + 1);
  fixes.forEach((f, k) => {
    const weight = 1 / f.uncertaintyM ** 2;
    w[k + 1] = w[k] + weight;
    lon[k + 1] = lon[k] + f.lon * weight;
    lat[k + 1] = lat[k] + f.lat * weight;
    unc[k + 1] = unc[k] + f.uncertaintyM;
  });
  return {
    centre: (a: number, b: number): Point => ({
      lon: (lon[b] - lon[a]) / (w[b] - w[a]),
      lat: (lat[b] - lat[a]) / (w[b] - w[a]),
    }),
    meanUncertainty: (a: number, b: number) => (unc[b] - unc[a]) / (b - a),
  };
}

interface Verdict {
  stationary: boolean;
  /** The window's centre — a steadier estimate of where a stationary fix lies than the fix. */
  centre: Point;
  radiusM: number;
}

function verdicts(fixes: readonly StayFix[], windowMs: number): Verdict[] {
  const sums = prefixSums(fixes);
  const tStart = fixes[0].t;
  const tEnd = fixes[fixes.length - 1].t;
  return fixes.map((fix) => {
    // Centred on the fix, slid inward at either end of the recording so a
    // stay at the very start or end is judged on a full window.
    let lo = Math.max(fix.t - windowMs / 2, tStart);
    let hi = lo + windowMs;
    if (hi > tEnd) {
      hi = tEnd;
      lo = Math.max(tStart, hi - windowMs);
    }
    const a = lowerBound(fixes, lo);
    const m = lowerBound(fixes, (lo + hi) / 2);
    const b = lowerBound(fixes, hi + 1);
    const self: Verdict = { stationary: false, centre: fix, radiusM: fix.uncertaintyM };
    if (m - a < 1 || b - m < 1 || b - a < 3) return self;
    const radiusM = sums.meanUncertainty(a, b);
    const displacement = distanceM(sums.centre(a, m), sums.centre(m, b));
    return { stationary: displacement <= radiusM, centre: sums.centre(a, b), radiusM };
  });
}

/** Runs of stationary fixes, `[start, end)`. */
function stationaryRuns(all: readonly Verdict[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let k = 0;
  while (k < all.length) {
    if (!all[k].stationary) {
      k += 1;
      continue;
    }
    const start = k;
    while (k < all.length && all[k].stationary) k += 1;
    runs.push([start, k]);
  }
  return runs;
}

interface Draft {
  start: number;
  end: number;
  centre: Point;
  radiusM: number;
}

function draftOf(all: readonly Verdict[], start: number, end: number): Draft {
  const inRun = all.slice(start, end);
  return {
    start,
    end,
    centre: {
      lon: median(inRun.map((v) => v.centre.lon)),
      lat: median(inRun.map((v) => v.centre.lat)),
    },
    radiusM: median(inRun.map((v) => v.radiusM)),
  };
}

/** Two runs at the same place with only a short burst between them are one stay. */
function mergeRuns(
  fixes: readonly StayFix[],
  all: readonly Verdict[],
  runs: ReadonlyArray<[number, number]>,
  windowMs: number
): Draft[] {
  const merged: Draft[] = [];
  for (const [start, end] of runs) {
    const previous = merged[merged.length - 1];
    const next = draftOf(all, start, end);
    const close =
      previous !== undefined &&
      fixes[start].t - fixes[previous.end - 1].t <= windowMs &&
      distanceM(previous.centre, next.centre) <= Math.max(previous.radiusM, next.radiusM);
    // The merged stay keeps the earlier run's centre: it is the longer-lived
    // estimate, and recomputing it over a growing range on every merge would
    // make a day-long stay quadratic.
    if (close) merged[merged.length - 1] = { ...previous, end };
    else merged.push(next);
  }
  return merged;
}

/** Reaches out to the furthest fix within the window that still lies inside the stay. */
function extend(
  fixes: readonly StayFix[],
  draft: Draft,
  floor: number,
  ceiling: number,
  windowMs: number
): Draft {
  const inside = (k: number) => distanceM(fixes[k], draft.centre) <= draft.radiusM;
  let start = draft.start;
  for (let k = draft.start - 1; k >= floor && fixes[draft.start].t - fixes[k].t <= windowMs; k--) {
    if (inside(k)) start = k;
  }
  let end = draft.end;
  for (let k = draft.end; k < ceiling && fixes[k].t - fixes[draft.end - 1].t <= windowMs; k++) {
    if (inside(k)) end = k + 1;
  }
  return { ...draft, start, end };
}

/** The stays of a time-ordered, fully timed run of fixes, in order and disjoint. */
export function findStays(fixes: readonly StayFix[], profile: JitterProfile): Stay[] {
  if (fixes.length < 2) return [];
  const windowMs = stayWindowMs(fixes, profile);
  const all = verdicts(fixes, windowMs);
  const drafts = mergeRuns(fixes, all, stationaryRuns(all), windowMs);

  const stays: Stay[] = [];
  drafts.forEach((draft, k) => {
    const floor = stays.length > 0 ? stays[stays.length - 1].end : 0;
    const ceiling = drafts[k + 1]?.start ?? fixes.length;
    const grown = extend(fixes, draft, Math.max(floor, 0), ceiling, windowMs);
    const lasted = fixes[grown.end - 1].t - fixes[grown.start].t;
    if (grown.end - grown.start >= 2 && lasted >= profile.minStayMs) {
      stays.push({
        start: Math.max(grown.start, floor),
        end: grown.end,
        lon: grown.centre.lon,
        lat: grown.centre.lat,
      });
    }
  });
  return stays;
}

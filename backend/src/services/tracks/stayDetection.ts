import { haversineKm } from "../../shared/geo/haversine";
import type { JitterProfile } from "./jitterProfiles";
import { isCheckpoint, medianPaced, runPaced, type Paced } from "./pacing";

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
 * the fixes' own accuracy (never below the profile's floor), capped at what
 * the mode's slowest real movement covers in half a window — so nothing
 * moving faster than `minMoveKmh` is ever called a stay, whatever accuracy
 * the phone reports. A whole stay is bounded too (`staysPut`).
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

/** The window: the profile's minimum stay, or `STAY_WINDOW_STEPS` sampling steps. */
export function stayWindowMs(fixes: readonly StayFix[], profile: JitterProfile): number {
  return runPaced(stayWindowMsPaced(fixes, profile));
}

function* stayWindowMsPaced(fixes: readonly StayFix[], profile: JitterProfile): Paced<number> {
  const steps = new Float64Array(Math.max(0, fixes.length - 1));
  let count = 0;
  for (let k = 1; k < fixes.length; k++) {
    const dt = fixes[k].t - fixes[k - 1].t;
    if (dt > 0) steps[count++] = dt;
    if (isCheckpoint(k)) yield;
  }
  const typical = count > 0 ? yield* medianPaced(steps.subarray(0, count)) : 0;
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

/**
 * Above this speed held in one direction, a window is movement even when its
 * two halves share a centre. A lap that comes round within half a window — a
 * velodrome, a running track, a kart circuit — puts both half-window centres
 * on the middle of the circle, and the displacement test alone collapsed ten
 * minutes of riding into one point (final review of forgejo#319). A lap
 * outside the stay radius that closes within half a window is at least
 * 2π · 20 m per minute, 7.5 km/h; a still phone's scatter never holds a
 * heading, so it never comes near.
 */
export const PERSISTENT_MOVE_KMH = 5;

const M_PER_DEG = 111_320;

interface Sums {
  centre: (a: number, b: number) => Point;
  meanUncertainty: (a: number, b: number) => number;
  /** Metres a window's fixes travelled while holding their heading, per second of the window. */
  persistentSpeedMps: (a: number, b: number) => number;
}

/**
 * How far the step into fix `k + 1` carried on in the direction of the step
 * into fix `k`: its length projected onto that heading. Positive when the
 * recording keeps going, negative when it turns back — and a still phone's
 * scatter turns back as often as not, so over a window it sums to nothing
 * while a lap sums to its length.
 */
function carriedOnM(fixes: readonly StayFix[], k: number): number {
  const a = fixes[k - 1];
  const b = fixes[k];
  const c = fixes[k + 1];
  const cosLat = Math.cos((b.lat * Math.PI) / 180);
  const x1 = (b.lon - a.lon) * cosLat;
  const y1 = b.lat - a.lat;
  const x2 = (c.lon - b.lon) * cosLat;
  const y2 = c.lat - b.lat;
  const length = Math.hypot(x1, y1);
  return length === 0 ? 0 : ((x1 * x2 + y1 * y2) / length) * M_PER_DEG;
}

/** Prefix sums so any range's weighted centre, mean uncertainty and persistent speed cost O(1). */
function* prefixSums(fixes: readonly StayFix[]): Paced<Sums> {
  const n = fixes.length;
  const w = new Float64Array(n + 1);
  const lon = new Float64Array(n + 1);
  const lat = new Float64Array(n + 1);
  const unc = new Float64Array(n + 1);
  const carried = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const f = fixes[k];
    const weight = 1 / f.uncertaintyM ** 2;
    w[k + 1] = w[k] + weight;
    lon[k + 1] = lon[k] + f.lon * weight;
    lat[k + 1] = lat[k] + f.lat * weight;
    unc[k + 1] = unc[k] + f.uncertaintyM;
    carried[k + 1] = carried[k] + (k > 0 && k < n - 1 ? carriedOnM(fixes, k) : 0);
    if (isCheckpoint(k)) yield;
  }
  return {
    centre: (a: number, b: number): Point => ({
      lon: (lon[b] - lon[a]) / (w[b] - w[a]),
      lat: (lat[b] - lat[a]) / (w[b] - w[a]),
    }),
    meanUncertainty: (a: number, b: number) => (unc[b] - unc[a]) / (b - a),
    // Fixes a+1 … b-2 each have both their steps inside [a, b).
    persistentSpeedMps: (a: number, b: number) => {
      const seconds = (fixes[b - 1].t - fixes[a].t) / 1000;
      return b - a < 3 || seconds <= 0 ? 0 : (carried[b - 1] - carried[a + 1]) / seconds;
    },
  };
}

interface Verdict {
  stationary: boolean;
  /** The window's centre — a steadier estimate of where a stationary fix lies than the fix. */
  centre: Point;
  radiusM: number;
}

/**
 * The displacement a window may show and still be standing: the fixes' own
 * accuracy, but never more than the mode's slowest real movement covers in
 * half a window. Uncapped, a phone reporting 100 m let a walk at 4 km/h pass
 * as standing (review of forgejo#319).
 */
function thresholdM(meanUncertaintyM: number, windowMs: number, profile: JitterProfile): number {
  const guardM = (profile.minMoveKmh / 3.6) * (windowMs / 2000);
  return Math.min(meanUncertaintyM, guardM);
}

function* verdicts(
  fixes: readonly StayFix[],
  windowMs: number,
  profile: JitterProfile
): Paced<Verdict[]> {
  const sums = yield* prefixSums(fixes);
  const tStart = fixes[0].t;
  const tEnd = fixes[fixes.length - 1].t;
  const all: Verdict[] = [];
  for (let k = 0; k < fixes.length; k++) {
    all.push(verdictOf(fixes, fixes[k], sums, tStart, tEnd, windowMs, profile));
    if (isCheckpoint(k)) yield;
  }
  return all;
}

function verdictOf(
  fixes: readonly StayFix[],
  fix: StayFix,
  sums: Sums,
  tStart: number,
  tEnd: number,
  windowMs: number,
  profile: JitterProfile
): Verdict {
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
  const radiusM = thresholdM(sums.meanUncertainty(a, b), windowMs, profile);
  const displacement = distanceM(sums.centre(a, m), sums.centre(m, b));
  const stationary =
    displacement <= radiusM && sums.persistentSpeedMps(a, b) * 3.6 < PERSISTENT_MOVE_KMH;
  return { stationary, centre: sums.centre(a, b), radiusM };
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

function* draftOf(all: readonly Verdict[], start: number, end: number): Paced<Draft> {
  const lon = new Float64Array(end - start);
  const lat = new Float64Array(end - start);
  const radius = new Float64Array(end - start);
  for (let k = start; k < end; k++) {
    lon[k - start] = all[k].centre.lon;
    lat[k - start] = all[k].centre.lat;
    radius[k - start] = all[k].radiusM;
    if (isCheckpoint(k)) yield;
  }
  return {
    start,
    end,
    centre: { lon: yield* medianPaced(lon), lat: yield* medianPaced(lat) },
    radiusM: yield* medianPaced(radius),
  };
}

/** Two runs at the same place with only a short burst between them are one stay. */
function* mergeRuns(
  fixes: readonly StayFix[],
  all: readonly Verdict[],
  runs: ReadonlyArray<[number, number]>,
  windowMs: number
): Paced<Draft[]> {
  const merged: Draft[] = [];
  for (const [start, end] of runs) {
    yield;
    const previous = merged[merged.length - 1];
    const next = yield* draftOf(all, start, end);
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

/**
 * Whether a stay as a whole stood still: its window centres never stray
 * further than a coarse fix could (`maxAccuracyM`), and from its first to its
 * last it drifts no faster than the mode's slowest real movement. Without
 * these bounds a slow movement whose every window looked still — or two stays
 * merged across a creeping drift — became one point however far it went.
 */
function* staysPut(
  fixes: readonly StayFix[],
  all: readonly Verdict[],
  draft: Draft,
  profile: JitterProfile
): Paced<boolean> {
  for (let k = draft.start; k < draft.end; k++) {
    if (distanceM(all[k].centre, draft.centre) > profile.maxAccuracyM) return false;
    if (isCheckpoint(k)) yield;
  }
  const spanS = (fixes[draft.end - 1].t - fixes[draft.start].t) / 1000;
  const drift = distanceM(all[draft.start].centre, all[draft.end - 1].centre);
  return drift <= Math.max(draft.radiusM, (profile.minMoveKmh / 3.6) * spanS);
}

/** The stays of a time-ordered, fully timed run of fixes, in order and disjoint. */
export function findStays(fixes: readonly StayFix[], profile: JitterProfile): Stay[] {
  return runPaced(findStaysPaced(fixes, profile));
}

/** `findStays` with checkpoints (`pacing.ts`). */
export function* findStaysPaced(fixes: readonly StayFix[], profile: JitterProfile): Paced<Stay[]> {
  if (fixes.length < 2) return [];
  const windowMs = yield* stayWindowMsPaced(fixes, profile);
  const all = yield* verdicts(fixes, windowMs, profile);
  const drafts = yield* mergeRuns(fixes, all, stationaryRuns(all), windowMs);

  const stays: Stay[] = [];
  for (let k = 0; k < drafts.length; k++) {
    yield;
    const draft = drafts[k];
    const floor = stays.length > 0 ? stays[stays.length - 1].end : 0;
    const ceiling = drafts[k + 1]?.start ?? fixes.length;
    if (!(yield* staysPut(fixes, all, draft, profile))) continue;
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
  }
  return stays;
}

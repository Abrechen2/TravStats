import { haversineKm } from "../../shared/geo/haversine";
import type { JitterProfile } from "./jitterProfiles";
import { isCheckpoint, medianPaced, runPaced, runPacedYielding, type Paced } from "./pacing";
import { findStaysPaced, type StayFix } from "./stayDetection";

/**
 * GPS jitter out of a recording, before anything is drawn, simplified or
 * measured (forgejo#319). Pure: fixes in, kept fixes out.
 *
 * A phone that is not moving does not report one position. At a gate, on a
 * taxiway, in a café, it reports a cloud of them tens to hundreds of metres
 * across, and joined in time order that cloud is a zigzag on the map and
 * kilometres in the distance that nobody travelled. A tester's flight read
 * "491 km · 527 points" with the zigzag drawn where the plane stood. The idea
 * is Dawarich's anomaly filter (speed outliers, teleports, frozen fixes),
 * applied in three passes per recording segment:
 *
 *  1. **Coarse fixes.** A fix whose reported accuracy is worse than the
 *     profile's `maxAccuracyM` is dropped when a satellite-grade fix exists
 *     within `COARSE_NEIGHBOUR_MS` of it — that neighbour already says where
 *     the phone was. A long run of coarse fixes with no better one near is
 *     kept: it is the only record of that stretch.
 *  2. **Frozen fixes and teleports** (timed segments only). A fix that repeats
 *     an earlier position to the last digit, at a speed the mode cannot
 *     reach from the fix before nor on to the fix after, is a stale cached
 *     position, not a return. A fix the previous kept fix
 *     could not reach at the mode's top speed is a teleport when the
 *     recording comes back within `MAX_SPIKE_FIXES` to a fix the spike could
 *     not have reached either — the out-and-back spike. Without that return it is kept: a real jump, or the start of a
 *     stretch after a hole, is not ours to delete.
 *  3. **Stays** (timed segments only, `stayDetection.ts`). Fixes that stay
 *     within their own accuracy radius (never less than the profile's floor)
 *     of one place for at least `minStayMs` collapse to the middle of the
 *     cloud, kept twice: when the stay began and when it ended. Judged over a window,
 *     not fix by fix, so a cloud wider than the radius is still one stay.
 *
 * What is never touched: a segment without times for every fix (a drawn
 * route, a KML line) — standing still and moving slowly cannot be told apart
 * without a clock, so such a segment is reported as unchecked rather than
 * guessed at; and slow real movement, which the `minStayMs` guard keeps (see
 * `jitterProfiles.ts` for the speed below which each mode would collapse).
 * Identical consecutive fixes with advancing time are a phone standing still
 * and reporting it truthfully; they join a stay like any other.
 */

/** One fix as the filter reads it. `t` in epoch ms; `accuracyM` as the phone reported it. */
export interface JitterFix {
  lon: number;
  lat: number;
  t: number | null;
  accuracyM: number | null;
}

export interface JitterResult {
  /** The kept fixes, a stay as two: its middle at arrival and at departure. */
  fixes: JitterFix[];
  /** For each kept fix, the input indices it stands for (a stay's arrival: all of them). */
  sources: number[][];
  /** Where each recording segment starts in `fixes`; always begins at 0. */
  segmentStarts: number[];
  /** Input fixes not in the output as themselves: dropped, or folded into a stay. */
  dropped: number;
  /**
   * Whether any segment could be checked at all. False when no segment had a
   * time on every fix and no fix carried an accuracy — then `dropped` is 0
   * because nothing was looked at, not because nothing was found.
   */
  checked: boolean;
}

/** A coarse fix is dropped when a better one lies this close in time. */
export const COARSE_NEIGHBOUR_MS = 2 * 60_000;
/** The longest out-and-back spike, in fixes. Phones teleport for one to three. */
export const MAX_SPIKE_FIXES = 3;
/** How far back a repeated position is still recognised as a frozen fix. */
export const FROZEN_LOOKBACK_FIXES = 10;

const HOUR_MS = 3_600_000;

function distanceM(a: JitterFix, b: { lon: number; lat: number }): number {
  return haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) * 1000;
}

/** A fix's own uncertainty: its accuracy, never below the floor nor above the coarse limit. */
function uncertaintyM(fix: JitterFix, profile: JitterProfile): number {
  const reported = fix.accuracyM ?? profile.floorRadiusM;
  return Math.min(Math.max(reported, profile.floorRadiusM), profile.maxAccuracyM);
}

function isCoarse(fix: JitterFix, profile: JitterProfile): boolean {
  return fix.accuracyM !== null && fix.accuracyM > profile.maxAccuracyM;
}

/**
 * Whether `to` is reachable from `from` at the mode's top speed. The distance
 * is shortened by both fixes' uncertainty first: two fixes a second apart
 * that differ by less than their own accuracy imply no speed at all.
 */
function reachable(from: JitterFix, to: JitterFix, profile: JitterProfile): boolean {
  const slackM = uncertaintyM(from, profile) + uncertaintyM(to, profile);
  const effectiveKm = Math.max(0, distanceM(from, to) - slackM) / 1000;
  if (effectiveKm === 0) return true;
  const hours = ((to.t ?? 0) - (from.t ?? 0)) / HOUR_MS;
  if (hours <= 0) return false;
  return effectiveKm / hours <= profile.maxSpeedKmh;
}

function segmentBounds(total: number, starts: readonly number[]): Array<[number, number]> {
  const cleaned = [
    ...new Set(starts.filter((i) => Number.isInteger(i) && i > 0 && i < total)),
  ].sort((a, b) => a - b);
  const all = [0, ...cleaned];
  return all.map((start, k): [number, number] => [start, all[k + 1] ?? total]);
}

/** Pass 1: coarse fixes with a better fix close by. Indices into `fixes`. */
function* dropCoarse(
  fixes: readonly JitterFix[],
  indices: readonly number[],
  profile: JitterProfile
): Paced<number[]> {
  const n = indices.length;
  const isBetter = (k: number) =>
    fixes[indices[k]].accuracyM !== null && !isCoarse(fixes[indices[k]], profile);
  // The nearest better fix on each side, found in one sweep each way: O(n)
  // whatever the timestamps. Walking outward from every coarse fix instead
  // cost n² when many fixes share a timestamp (review of forgejo#319).
  const before = new Int32Array(n).fill(-1);
  const after = new Int32Array(n).fill(-1);
  for (let k = 1; k < n; k++) {
    before[k] = isBetter(k - 1) ? k - 1 : before[k - 1];
    if (isCheckpoint(k)) yield;
  }
  for (let k = n - 2; k >= 0; k--) {
    after[k] = isBetter(k + 1) ? k + 1 : after[k + 1];
    if (isCheckpoint(k)) yield;
  }
  // Close: within the window in time, or (untimed) within a few fixes. The
  // nearest better fix by position is the nearest in time as well, because a
  // segment is judged in its own order.
  const close = (k: number, m: number) => {
    if (m < 0) return false;
    const t = fixes[indices[k]].t;
    const tm = fixes[indices[m]].t;
    return t === null || tm === null
      ? Math.abs(m - k) <= MAX_SPIKE_FIXES
      : Math.abs(tm - t) <= COARSE_NEIGHBOUR_MS;
  };
  const kept: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    if (!isCoarse(fixes[i], profile) || !(close(k, before[k]) || close(k, after[k]))) kept.push(i);
    if (isCheckpoint(k)) yield;
  }
  return kept;
}

/**
 * Pass 2a: a stale cached position. A phone that loses its fix may hand back
 * an earlier position to the last digit; that is frozen only when it is also
 * IMPOSSIBLE — the previous kept fix could not have reached it, nor it the
 * next fix. An exact repeat alone proves nothing: a ride retracing its own
 * rounded points, or a cable car back at its terminal, returns to the same
 * coordinate at a speed the mode allows (review of forgejo#319).
 */
function* dropFrozen(
  fixes: readonly JitterFix[],
  indices: readonly number[],
  profile: JitterProfile
): Paced<number[]> {
  const kept: number[] = [];
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const fix = fixes[i];
    const previous = kept[kept.length - 1];
    const next = indices[k + 1];
    const frozen =
      previous !== undefined &&
      next !== undefined &&
      kept
        .slice(-FROZEN_LOOKBACK_FIXES - 1, -1)
        .some((j) => fixes[j].lon === fix.lon && fixes[j].lat === fix.lat) &&
      !reachable(fixes[previous], fix, profile) &&
      !reachable(fix, fixes[next], profile);
    if (!frozen) kept.push(i);
    if (isCheckpoint(k)) yield;
  }
  return kept;
}

/** Pass 2b: out-and-back spikes the mode cannot fly, drive or walk. */
function* dropSpikes(
  fixes: readonly JitterFix[],
  indices: readonly number[],
  profile: JitterProfile
): Paced<number[]> {
  let list = [...indices];
  // The first fix itself can be the spike: nothing before it to come back to,
  // so it is judged by the two after it agreeing with each other instead.
  if (
    list.length >= 3 &&
    !reachable(fixes[list[0]], fixes[list[1]], profile) &&
    !reachable(fixes[list[0]], fixes[list[2]], profile) &&
    reachable(fixes[list[1]], fixes[list[2]], profile)
  ) {
    list = list.slice(1);
  }
  const kept: number[] = list.length > 0 ? [list[0]] : [];
  let k = 1;
  for (let steps = 0; k < list.length; steps++) {
    if (isCheckpoint(steps)) yield;
    const from = fixes[kept[kept.length - 1]];
    if (reachable(from, fixes[list[k]], profile)) {
      kept.push(list[k]);
      k += 1;
      continue;
    }
    // A spike is impossible on BOTH sides: the recording comes back to where
    // it was, and the spike could not have reached that return either. A fix
    // the return is reachable from is the recording moving on fast, not a spike.
    let back = -1;
    for (let m = k + 1; m < list.length && m <= k + MAX_SPIKE_FIXES; m++) {
      if (reachable(from, fixes[list[m]], profile)) {
        back = m;
        break;
      }
    }
    if (back !== -1 && reachable(fixes[list[k]], fixes[list[back]], profile)) back = -1;
    if (back === -1) {
      kept.push(list[k]);
      k += 1;
    } else {
      k = back;
    }
  }
  return kept;
}

interface Group {
  members: number[];
  lon: number;
  lat: number;
}

/** Pass 3: stays collapsed (`stayDetection.ts`). Each group is one output fix. */
function* collapseStays(
  fixes: readonly JitterFix[],
  list: readonly number[],
  profile: JitterProfile
): Paced<Group[]> {
  const timed: StayFix[] = [];
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    timed.push({
      lon: fixes[i].lon,
      lat: fixes[i].lat,
      t: fixes[i].t ?? 0,
      uncertaintyM: uncertaintyM(fixes[i], profile),
    });
    if (isCheckpoint(k)) yield;
  }
  const groups: Group[] = [];
  let k = 0;
  for (const stay of yield* findStaysPaced(timed, profile)) {
    for (; k < stay.start; k++) {
      groups.push(single(fixes, list[k]));
      if (isCheckpoint(k)) yield;
    }
    groups.push({ members: list.slice(stay.start, stay.end), lon: stay.lon, lat: stay.lat });
    k = stay.end;
  }
  for (; k < list.length; k++) {
    groups.push(single(fixes, list[k]));
    if (isCheckpoint(k)) yield;
  }
  return groups;
}

function single(fixes: readonly JitterFix[], i: number): Group {
  return { members: [i], lon: fixes[i].lon, lat: fixes[i].lat };
}

/**
 * Every fix timed, in time order. A segment whose clock runs backwards is
 * not one a speed or a window can be read from; it is left alone.
 */
function* isFullyTimed(fixes: readonly JitterFix[], indices: readonly number[]): Paced<boolean> {
  for (let k = 0; k < indices.length; k++) {
    const t = fixes[indices[k]].t;
    if (t === null || !Number.isFinite(t)) return false;
    const before = k > 0 ? fixes[indices[k - 1]].t : null;
    if (before !== null && t < before) return false;
    if (isCheckpoint(k)) yield;
  }
  return true;
}

/**
 * The fixes that stand for a group: itself for a single fix; for a stay, the
 * middle of the cloud TWICE — when the stay began and when it ended. One
 * point at the arrival time left the hours of the stop between it and the
 * next fix, and the trip recording's gap rule (> 2 h) cut its line there
 * although the phone had recorded all along (review of forgejo#319).
 */
function* representatives(
  fixes: readonly JitterFix[],
  group: Group
): Paced<Array<{ fix: JitterFix; sources: number[] }>> {
  const first = group.members[0];
  if (group.members.length === 1) return [{ fix: fixes[first], sources: [first] }];
  const lastMember = group.members[group.members.length - 1];
  const accuracies = new Float64Array(group.members.length);
  let count = 0;
  for (let k = 0; k < group.members.length; k++) {
    const accuracy = fixes[group.members[k]].accuracyM;
    if (accuracy !== null) accuracies[count++] = accuracy;
    if (isCheckpoint(k)) yield;
  }
  const accuracyM = count > 0 ? yield* medianPaced(accuracies.subarray(0, count)) : null;
  const at = (t: number | null): JitterFix => ({ lon: group.lon, lat: group.lat, t, accuracyM });
  return [
    { fix: at(fixes[first].t), sources: group.members },
    { fix: at(fixes[lastMember].t), sources: [lastMember] },
  ];
}

/**
 * The filter. `segmentStarts` are the recording's own breaks (a file's
 * `<trkseg>`s); nothing is compared across one. Every output segment keeps at
 * least one fix, so a segment never disappears. Runs straight through: for
 * input a request has already bounded (`pacing.ts`).
 */
export function filterJitter(
  fixes: readonly JitterFix[],
  segmentStarts: readonly number[],
  profile: JitterProfile
): JitterResult {
  return runPaced(filterJitterPaced(fixes, segmentStarts, profile));
}

/**
 * The same filter, handing the event loop back every few milliseconds — for
 * a read whose input has no upper size (`pacing.ts`). Same result.
 */
export function filterJitterYielding(
  fixes: readonly JitterFix[],
  segmentStarts: readonly number[],
  profile: JitterProfile
): Promise<JitterResult> {
  return runPacedYielding(filterJitterPaced(fixes, segmentStarts, profile));
}

function* filterJitterPaced(
  fixes: readonly JitterFix[],
  segmentStarts: readonly number[],
  profile: JitterProfile
): Paced<JitterResult> {
  const out: JitterFix[] = [];
  const sources: number[][] = [];
  const starts: number[] = [];
  let checked = false;

  for (const [start, end] of segmentBounds(fixes.length, segmentStarts)) {
    const raw = Array.from({ length: end - start }, (_, k) => start + k);
    if (raw.some((i) => fixes[i].accuracyM !== null)) checked = true;
    let kept = yield* dropCoarse(fixes, raw, profile);
    let groups: Group[];
    if (yield* isFullyTimed(fixes, kept)) {
      checked = true;
      kept = yield* dropSpikes(fixes, yield* dropFrozen(fixes, kept, profile), profile);
      groups = yield* collapseStays(fixes, kept, profile);
    } else {
      groups = kept.map((i) => single(fixes, i));
    }
    starts.push(out.length);
    for (let g = 0; g < groups.length; g++) {
      for (const { fix, sources: from } of yield* representatives(fixes, groups[g])) {
        out.push(fix);
        sources.push(from);
      }
      if (isCheckpoint(g)) yield;
    }
  }

  return {
    fixes: out,
    sources,
    segmentStarts: starts,
    dropped: fixes.length - out.length,
    checked,
  };
}

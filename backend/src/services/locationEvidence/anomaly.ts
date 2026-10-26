/**
 * Anomalies of a position history (TravTrack plan E2, spec §10 point 1): the
 * same thresholds the other location provider applies, judged per device.
 *
 *   - an accuracy worse than 10 km, or a fix at null island, is masked;
 *   - a JUMP is a step between two consecutive fixes of one device that
 *     covers more than 1 km within the same second, or runs faster than
 *     `max(1000 km/h, 3 × the device's median speed)`;
 *   - a run of at most five fixes between two jumps is masked — the phone
 *     handed over a stale or wrong fix and came back. Six or more are a real
 *     move, and a single jump with no return is left alone: which side of it
 *     is wrong cannot be told.
 *
 * In the air no step is a speed jump: a step whose span touches one of the
 * account's flight windows is an aircraft's, and ~1,100 km/h with a tailwind
 * is a flight, not a teleport. Bad fixes are masked in the air all the same,
 * and a same-second step of more than 1 km is no aircraft's motion either.
 * Those steps are left out of the median too.
 *
 * Masked, never deleted: the mask is a verdict on this read, the stored
 * points stay as they are.
 *
 * `stableCut` says where a read may stop so that its verdicts are final: a
 * run still open at the end of a read, or one a cut would split, is handed to
 * the next read whole, with each device's last good fix as context. A split
 * read then masks like an unsplit one — given the device's speed limit is the
 * 1000 km/h floor, i.e. its median speed below 333 km/h, which a ground history
 * always is (the median is the one figure judged per read).
 *
 * The read looks ahead for a run's end, but only so far (`LOOKAHEAD_MAX` in
 * `derivationRead.ts`): runs of many devices can overlap in a chain that
 * keeps some run open at every point. At the cap the read cuts at its end
 * (`stableCut` with `atEnd`) and says so (`unresolvedRun`) — the next read may
 * then judge that boundary differently from an unsplit read, and nothing
 * claims it does not.
 */
import { haversineKm } from "../../shared/geo/haversine";
import type { LocationObservation } from "../locationProvider/types";

export const MAX_ACCURACY_M = 10_000;
export const SAME_SECOND_JUMP_KM = 1;
export const MIN_JUMP_SPEED_KMH = 1000;
export const MEDIAN_SPEED_FACTOR = 3;
export const MAX_MASKED_RUN = 5;

const MS_PER_HOUR = 3_600_000;

/** Within ~11 m of 0°, 0°: the fix a phone reports when it has none. */
const NULL_ISLAND_DEG = 0.0001;

type Fix = Pick<LocationObservation, "atMs" | "lat" | "lon" | "accuracyM">;

/** `[fromMs, toMs]`, inclusive: a flight's recorder window. */
export type FlightWindow = readonly [number, number];

export type AnomalyOptions = { flightWindows?: readonly FlightWindow[] };

/**
 * No step longer than this can be a jump: half the earth's circumference at
 * the 1000 km/h floor is ~20 h. A fix older than that is no context.
 */
export const MAX_JUMP_STEP_MS = 21 * MS_PER_HOUR;

const isNullIsland = (p: Fix) =>
  Math.abs(p.lat) < NULL_ISLAND_DEG && Math.abs(p.lon) < NULL_ISLAND_DEG;

export const isBadFix = (p: Fix): boolean =>
  (p.accuracyM !== null && p.accuracyM > MAX_ACCURACY_M) || isNullIsland(p);

/**
 * Speed of a step in km/h, measured over at least one second: two fixes a
 * fraction of a second apart would otherwise turn GPS jitter into a jet.
 */
function stepSpeedKmh(a: Fix, b: Fix): number {
  const hours = Math.max(1000, b.atMs - a.atMs) / MS_PER_HOUR;
  return haversineKm(a, b) / hours;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const touchesFlight = (a: Fix, b: Fix, windows: readonly FlightWindow[]) =>
  windows.some(([from, to]) => a.atMs <= to && b.atMs >= from);

/** Indices into `fixes` where a jump lands (the step from `i - 1` to `i`). */
function jumpIndices(fixes: readonly Fix[], windows: readonly FlightWindow[]): number[] {
  const steps = fixes.slice(1).map((p, i) => ({
    speed: stepSpeedKmh(fixes[i], p),
    inFlight: touchesFlight(fixes[i], p, windows),
  }));
  const ground = steps.filter((s) => !s.inFlight).map((s) => s.speed);
  const limit = Math.max(MIN_JUMP_SPEED_KMH, MEDIAN_SPEED_FACTOR * median(ground));
  const jumps: number[] = [];
  for (let i = 1; i < fixes.length; i += 1) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const step = steps[i - 1];
    const sameSecond = Math.floor(a.atMs / 1000) === Math.floor(b.atMs / 1000);
    if (
      (sameSecond && haversineKm(a, b) > SAME_SECOND_JUMP_KM) ||
      (!step.inFlight && step.speed > limit)
    ) {
      jumps.push(i);
    }
  }
  return jumps;
}

type DeviceVerdict = {
  mask: boolean[];
  /** Indices into the device's fixes that are not bad fixes. */
  kept: number[];
  /** Masked runs as `[from, to)` into `kept`: `from` lands the first jump, `to` the return. */
  runs: Array<[number, number]>;
  /** Into `kept`: a jump at the end still waiting for its return, or null. */
  open: number | null;
};

/** One device's verdicts, `fixes` in time order. */
function judgeDevice(fixes: readonly Fix[], windows: readonly FlightWindow[]): DeviceVerdict {
  const mask = fixes.map(isBadFix);
  const kept = fixes.map((_, i) => i).filter((i) => !mask[i]);
  const jumps = jumpIndices(
    kept.map((i) => fixes[i]),
    windows
  );
  const runs: Array<[number, number]> = [];
  let k = 0;
  while (k + 1 < jumps.length) {
    const [from, to] = [jumps[k], jumps[k + 1]];
    if (to - from <= MAX_MASKED_RUN) {
      for (let j = from; j < to; j += 1) mask[kept[j]] = true;
      runs.push([from, to]);
      k += 2;
    } else {
      k += 1;
    }
  }
  // A last jump with at most five fixes after it can still be closed by the next read.
  const last = k < jumps.length ? jumps[k] : null;
  const open = last !== null && kept.length - last <= MAX_MASKED_RUN ? last : null;
  return { mask, kept, runs, open };
}

/** The input indices of each device's points, in input order. */
function byDevice(points: readonly LocationObservation[]): number[][] {
  const groups = new Map<string | null, number[]>();
  points.forEach((p, i) => {
    const list = groups.get(p.deviceId) ?? [];
    list.push(i);
    groups.set(p.deviceId, list);
  });
  return [...groups.values()];
}

/**
 * Which of these time-ordered observations are anomalies — `true` at the
 * index of each masked one, in the input's order. Devices are judged apart:
 * two phones far from each other are two histories, not a jump.
 */
export function anomalyMask(
  points: readonly LocationObservation[],
  opts: AnomalyOptions = {}
): boolean[] {
  const windows = opts.flightWindows ?? [];
  const mask = new Array<boolean>(points.length).fill(false);
  for (const indices of byDevice(points)) {
    const { mask: verdicts } = judgeDevice(
      indices.map((i) => points[i]),
      windows
    );
    indices.forEach((i, j) => {
      mask[i] = verdicts[j];
    });
  }
  return mask;
}

export type StableCut = {
  /** Points before this index carry final verdicts; the rest wait for the next read. */
  until: number;
  /** The next read starts here: each device's last good fix before `until`, as context. */
  contextFrom: number;
};

/**
 * Where a read that has to stop may stop with final verdicts (see the header).
 * The cut may land before anything new — then a run is still open, and the
 * caller reads on until it resolves rather than hand it on unresolved.
 * `atEnd` cuts at the end regardless, with each device's context: the
 * caller's last resort once its lookahead is spent.
 */
export function stableCut(
  points: readonly LocationObservation[],
  opts: AnomalyOptions = {},
  { atEnd = false }: { atEnd?: boolean } = {}
): StableCut {
  const windows = opts.flightWindows ?? [];
  const devices = byDevice(points).map((indices) => {
    const v = judgeDevice(
      indices.map((i) => points[i]),
      windows
    );
    const at = (k: number) => indices[v.kept[k]];
    return {
      goodFixes: v.kept.map((k) => indices[k]),
      // A cut inside `(start, end]` splits a run: `end` is the return.
      spans: [
        ...v.runs.map(([a, b]): [number, number] => [at(a), at(b)]),
        ...(v.open !== null ? [[at(v.open), Infinity] as [number, number]] : []),
      ],
    };
  });
  let until = points.length;
  for (let moved = !atEnd; moved;) {
    moved = false;
    for (const { spans } of devices) {
      for (const [start, end] of spans) {
        if (start < until && until <= end) {
          until = start;
          moved = true;
        }
      }
    }
  }
  const reference = points[Math.min(until, points.length - 1)]?.atMs ?? 0;
  let contextFrom = until;
  for (const { goodFixes } of devices) {
    const before = goodFixes.filter((i) => i < until);
    const last = before[before.length - 1];
    if (last !== undefined && reference - points[last].atMs <= MAX_JUMP_STEP_MS) {
      contextFrom = Math.min(contextFrom, last);
    }
  }
  return { until, contextFrom };
}

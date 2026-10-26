import type { FlightSample } from "../../../lib/api/travtrackViews";
import { toLocal } from "../../../shared/time/zone";
import { xAt, yAt, type ProfileFrame } from "./altitudeProfile";

/**
 * The altitude profile's axes and overlays (owner 2026-10-26, "den Graphen
 * besser machen"): round ticks for altitude and speed, clock ticks in the
 * departure zone with a mark at each local midnight, the bands where the
 * recording breaks, the area under the altitude and the speed line. Every
 * line runs inside ONE stretch only; a band marks what lies between two.
 */

/** Round ticks from 0 to at least `max`, about `target` of them (steps of 1, 2 or 5 × 10ⁿ). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

const QUARTER_MS = 15 * 60_000;
const HOUR_STEPS = [1, 2, 3, 4, 6, 12];

/** The place's clock at `ms`: hour and minute. */
function clockAt(ms: number, zone: string): { hour: number; minute: number } {
  const local = toLocal(ms, zone).local;
  return { hour: Number(local.slice(11, 13)), minute: Number(local.slice(14, 16)) };
}

/**
 * Clock ticks on whole local hours, every 1–12 hours so that at most
 * `maxTicks` fit, and the instants of each local midnight in between. Read on
 * quarter hours, so a zone half an hour off UTC still lands on its own hours.
 */
export function timeTicks(
  t0: number,
  t1: number,
  zone: string,
  maxTicks = 7
): { ticks: number[]; midnights: number[] } {
  const spanH = Math.max(1, (t1 - t0) / 3_600_000);
  const every = HOUR_STEPS.find((h) => spanH / h <= maxTicks) ?? 24;
  const ticks: number[] = [];
  const midnights: number[] = [];
  for (let ms = Math.ceil(t0 / QUARTER_MS) * QUARTER_MS; ms <= t1; ms += QUARTER_MS) {
    const { hour, minute } = clockAt(ms, zone);
    if (minute !== 0) continue;
    if (hour === 0) midnights.push(ms);
    if (hour % every === 0) ticks.push(ms);
  }
  return { ticks, midnights };
}

/** Between two stretches, where nothing was recorded: `[fromMs, untilMs]` longer than `minMs`. */
export function gapBands(
  series: readonly FlightSample[][],
  minMs = 60_000
): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  for (let i = 1; i < series.length; i++) {
    const before = series[i - 1][series[i - 1].length - 1];
    const after = series[i][0];
    if (before && after && after[0] - before[0] > minMs) bands.push([before[0], after[0]]);
  }
  return bands;
}

/** Runs of neighbouring samples inside one stretch that carry `pick`. */
function runsOf(
  series: readonly FlightSample[][],
  pick: (s: FlightSample) => number | null
): FlightSample[][] {
  const runs: FlightSample[][] = [];
  for (const stretch of series) {
    let run: FlightSample[] = [];
    for (const s of stretch) {
      if (pick(s) === null) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      run.push(s);
    }
    if (run.length > 1) runs.push(run);
  }
  return runs;
}

/** The area under the altitude, one closed shape per unbroken run. */
export function areaPaths(series: readonly FlightSample[][], f: ProfileFrame): string[] {
  return runsOf(series, (s) => s[1]).map((run) => {
    const top = run.map((s) => `${xAt(f, s[0]).toFixed(1)},${yAt(f, s[1] as number).toFixed(1)}`);
    const x0 = xAt(f, run[0][0]).toFixed(1);
    const x1 = xAt(f, run[run.length - 1][0]).toFixed(1);
    return `M${x0},${f.height}L${top.join("L")}L${x1},${f.height}Z`;
  });
}

/** The speed in km/h against its own axis (`topKmh` at the top), one path per run. */
export function speedPaths(
  series: readonly FlightSample[][],
  f: ProfileFrame,
  topKmh: number
): string[] {
  const y = (mps: number) => f.height - (Math.max(0, mps * 3.6) / Math.max(1, topKmh)) * f.height;
  return runsOf(series, (s) => s[2]).map(
    (run) =>
      `M${run.map((s) => `${xAt(f, s[0]).toFixed(1)},${y(s[2] as number).toFixed(1)}`).join("L")}`
  );
}

/** The highest speed in km/h, or null. */
export function topSpeedKmh(series: readonly FlightSample[][]): number | null {
  let best: number | null = null;
  for (const run of series)
    for (const s of run) if (s[2] !== null) best = Math.max(best ?? 0, s[2] * 3.6);
  return best;
}

/** Every sample in time order, for the crosshair and the arrow keys. */
export const samplesOf = (series: readonly FlightSample[][]): FlightSample[] => series.flat();

/** The index of the sample nearest `t`, or -1 without samples. */
export function nearestIndex(samples: readonly FlightSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1][0] - t) <= Math.abs(samples[lo][0] - t)) return lo - 1;
  return lo;
}

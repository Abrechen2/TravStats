import type { FlightSample } from "../../../lib/api/travtrackViews";

/**
 * The flight panel's altitude profile (TravTrack plan T5.3), as SVG paths. A
 * line runs only between two neighbouring samples of ONE stretch that both
 * carry an altitude: a cut the server made, or a sample without altitude,
 * breaks the line — nothing is drawn across what was not recorded.
 */

export interface ProfileFrame {
  t0: number;
  t1: number;
  /** The top of the altitude axis, metres (≥ 1). */
  top: number;
  width: number;
  height: number;
}

export function profileFrame(
  series: readonly FlightSample[][],
  width: number,
  height: number
): ProfileFrame | null {
  let t0 = Infinity;
  let t1 = -Infinity;
  let top = 0;
  for (const run of series) {
    for (const [t, alt] of run) {
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
      if (alt !== null && alt > top) top = alt;
    }
  }
  if (t0 === Infinity) return null;
  return { t0, t1: t1 > t0 ? t1 : t0 + 1, top: Math.max(1, top), width, height };
}

export const xAt = (f: ProfileFrame, t: number): number => ((t - f.t0) / (f.t1 - f.t0)) * f.width;

export const yAt = (f: ProfileFrame, altitude: number): number =>
  f.height - (Math.max(0, altitude) / f.top) * f.height;

/** One `d` per unbroken run of samples with an altitude. */
export function profilePaths(series: readonly FlightSample[][], f: ProfileFrame): string[] {
  const paths: string[] = [];
  for (const run of series) {
    let current: string[] = [];
    const flush = () => {
      if (current.length > 1) paths.push(`M${current.join("L")}`);
      current = [];
    };
    for (const [t, alt] of run) {
      if (alt === null) {
        flush();
        continue;
      }
      current.push(`${xAt(f, t).toFixed(1)},${yAt(f, alt).toFixed(1)}`);
    }
    flush();
  }
  return paths;
}

/** The altitude at `t` inside one stretch, between its two neighbouring samples; null in a cut. */
export function altitudeAt(series: readonly FlightSample[][], t: number): number | null {
  for (const run of series) {
    for (let i = 0; i < run.length; i++) {
      const [ti, ai] = run[i];
      if (ti === t) return ai;
      const prev = run[i - 1];
      if (prev && prev[0] < t && t < ti) {
        if (prev[1] === null || ai === null) return null;
        return prev[1] + ((t - prev[0]) / (ti - prev[0])) * (ai - prev[1]);
      }
    }
  }
  return null;
}

/** Metres as a flight level (hundreds of feet), FL350 for 10 668 m. */
export const flightLevel = (m: number): number => Math.round((m * 3.28084) / 100);

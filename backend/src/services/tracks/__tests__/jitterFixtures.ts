/**
 * Synthetic recordings for the jitter filter's tests (forgejo#319). Every
 * fixture knows its TRUE path, so a test can say how far the measured
 * distance may sit from it. Deterministic: the "noise" is a fixed
 * pseudo-random sequence, never `Math.random`.
 */

export interface SyntheticFix {
  t: number;
  lat: number;
  lon: number;
  accuracy: number | null;
}

export const T0 = Date.UTC(2026, 9, 14, 6, 0, 0);
/** Frankfurt, gate A26 — any mid-latitude point would do. */
export const BASE = { lat: 50.0505, lon: 8.5698 };

const M_PER_DEG_LAT = 111_320;

/** The point `east` and `north` metres from `origin`. */
export function offset(
  origin: { lat: number; lon: number },
  east: number,
  north: number
): { lat: number; lon: number } {
  return {
    lat: origin.lat + north / M_PER_DEG_LAT,
    lon: origin.lon + east / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

/** A fixed sequence in [-1, 1) — the same "noise" on every run. */
export function noise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

/**
 * A phone standing still at `at` for `minutes`, one fix every `stepS`
 * seconds, wandering up to `wanderM` metres — the gate cloud.
 */
export function standing(
  at: { lat: number; lon: number },
  startMs: number,
  minutes: number,
  stepS: number,
  wanderM: number,
  accuracy: number | null = null,
  seed = 7
): SyntheticFix[] {
  const rnd = noise(seed);
  const count = Math.floor((minutes * 60) / stepS);
  return Array.from({ length: count }, (_, i) => {
    const p = offset(at, rnd() * wanderM, rnd() * wanderM);
    return { t: startMs + i * stepS * 1000, ...p, accuracy };
  });
}

/**
 * Straight movement from `from` on `bearingDeg` at `kmh` for `seconds`, one
 * fix every `stepS` seconds, the first fix one step after `startMs`.
 */
export function moving(
  from: { lat: number; lon: number },
  startMs: number,
  bearingDeg: number,
  kmh: number,
  seconds: number,
  stepS: number,
  accuracy: number | null = null
): SyntheticFix[] {
  const mps = kmh / 3.6;
  const rad = (bearingDeg * Math.PI) / 180;
  const count = Math.floor(seconds / stepS);
  return Array.from({ length: count }, (_, i) => {
    const d = mps * stepS * (i + 1);
    const p = offset(from, Math.sin(rad) * d, Math.cos(rad) * d);
    return { t: startMs + (i + 1) * stepS * 1000, ...p, accuracy };
  });
}

export function last<T>(list: readonly T[]): T {
  return list[list.length - 1];
}

/** The fixes as a one-segment GPX 1.1 file, every point timed. */
export function toGpx(fixes: readonly SyntheticFix[]): Buffer {
  const body = fixes
    .map(
      (f) =>
        `<trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${new Date(f.t).toISOString()}</time></trkpt>`
    )
    .join("\n");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"><trk><name>Jitter</name><trkseg>\n${body}\n</trkseg></trk></gpx>`
  );
}

/**
 * Standing at `at` for `standMinutes` (fixes every `stepS` s scattering
 * ±`wanderM`), then moving off due east at `kmh` for `moveSeconds`. The true
 * path is the movement alone: `kmh * moveSeconds / 3600` km.
 */
export function standThenMove(opts: {
  at: { lat: number; lon: number };
  startMs: number;
  standMinutes: number;
  wanderM: number;
  kmh: number;
  moveSeconds: number;
  stepS: number;
}): { fixes: SyntheticFix[]; standing: number; trueKm: number } {
  const still = standing(opts.at, opts.startMs, opts.standMinutes, opts.stepS, opts.wanderM);
  const off = moving(opts.at, last(still).t, 90, opts.kmh, opts.moveSeconds, opts.stepS);
  return {
    fixes: [...still, ...off],
    standing: still.length,
    trueKm: (opts.kmh * Math.floor(opts.moveSeconds / opts.stepS) * opts.stepS) / 3600,
  };
}

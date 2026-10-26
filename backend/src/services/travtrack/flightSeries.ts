/**
 * The flight panel's series arithmetic (TravTrack plan T5.3, owner 2026-10-26
 * "den kompletten Flug zeigen"): take-off and landing, the climb, and the
 * downsampling that lets a whole long-haul recording travel in one answer.
 * Pure functions over `[tMs, altitudeM, speedMps]` stretches; a stretch is
 * never joined to the next, and nothing here bridges one.
 */

/** `[tMs, altitudeM, speedMps]` of one shown vertex. */
export type FlightSample = [number, number | null, number | null];

/** At or above this a jet is flying: 60 m/s is 216 km/h, past every rotation speed. */
export const TAKEOFF_SPEED_MPS = 60;
/** Without speeds: this far above the ground the stretch began on. */
export const TAKEOFF_CLIMB_M = 300;
const CRUISE_MIN_ALTITUDE_M = 3000;
const GROUND_SHARE = 0.2;
const CRUISE_SHARE = 0.9;
/** A level-off: the altitude stays within this band … */
const LEVEL_BAND_M = 150;
/** … for at least this long. */
const LEVEL_HOLD_MS = 5 * 60_000;
/** A level-off below this share of the apex is a hold during the climb, not cruise. */
const LEVEL_MIN_SHARE = 0.6;
/** The most samples one answer carries. */
export const FLIGHT_PANEL_MAX_SAMPLES = 2000;

export const maxOf = (values: Iterable<number | null>): number | null => {
  let best: number | null = null;
  for (const v of values)
    if (v !== null && Number.isFinite(v) && (best === null || v > best)) best = v;
  return best;
};

function topAltitude(series: readonly FlightSample[][]): number | null {
  let best: number | null = null;
  for (const run of series) for (const s of run) best = maxOf([best, s[1]]);
  return best;
}

/** The stretch's first altitude, or null. */
const groundOf = (run: readonly FlightSample[]): number | null =>
  run.find((s) => s[1] !== null)?.[1] ?? null;

/**
 * Whether the sample is in the air: a speed says so where the phone gave one;
 * otherwise the altitude, measured from the ground the stretch began on.
 */
function airborne(s: FlightSample, ground: number | null): boolean {
  if (s[2] !== null) return s[2] >= TAKEOFF_SPEED_MPS;
  return s[1] !== null && ground !== null && s[1] >= ground + TAKEOFF_CLIMB_M;
}

/**
 * The take-off: the first airborne sample after at least one sample on the
 * ground in the same stretch, the ground being low (≤ 20 % of the highest
 * altitude). A series that starts in the air, or whose ground the recording
 * never saw, has no take-off — null, not a guess.
 */
export function takeoffOf(
  series: readonly FlightSample[][]
): { tMs: number; stretch: number; index: number } | null {
  const top = topAltitude(series);
  for (let r = 0; r < series.length; r++) {
    const run = series[r];
    const ground = groundOf(run);
    if (ground !== null && top !== null && ground > top * GROUND_SHARE) continue;
    let sawGround = false;
    for (let i = 0; i < run.length; i++) {
      if (!airborne(run[i], ground)) {
        sawGround = true;
        continue;
      }
      if (sawGround) return { tMs: run[i][0], stretch: r, index: i };
      break;
    }
  }
  return null;
}

/** The landing: the mirror of the take-off, from the end. */
export function landingOf(series: readonly FlightSample[][]): number | null {
  const top = topAltitude(series);
  for (let r = series.length - 1; r >= 0; r--) {
    const run = series[r];
    const ground = [...run].reverse().find((s) => s[1] !== null)?.[1] ?? null;
    if (ground !== null && top !== null && ground > top * GROUND_SHARE) continue;
    let sawGround = false;
    for (let i = run.length - 1; i >= 0; i--) {
      if (!airborne(run[i], ground)) {
        sawGround = true;
        continue;
      }
      if (sawGround) return run[i][0];
      break;
    }
  }
  return null;
}

/**
 * The first level-off of the cruise inside `run` from `from` on: a sample at
 * or above 60 % of the apex (and 3000 m) the altitude then stays within
 * ±150 m of for at least five minutes. A later step climb (LH719 levelled at
 * 10,500 m 37 min after take-off, stepped to 11,500 m hours later — beta.29
 * UAT) is cruise, not climb, so the first level wins.
 */
function firstLevelOff(
  run: readonly FlightSample[],
  from: number,
  top: number
): FlightSample | null {
  const floor = Math.max(CRUISE_MIN_ALTITUDE_M, top * LEVEL_MIN_SHARE);
  for (let i = from; i < run.length; i++) {
    const alt = run[i][1];
    if (alt === null || alt < floor) continue;
    let held = false;
    for (let j = i + 1; j < run.length; j++) {
      const next = run[j][1];
      // A missing altitude proves nothing: only a reading in the band holds the level.
      if (next === null) continue;
      if (Math.abs(next - alt) > LEVEL_BAND_M) break;
      if (run[j][0] - run[i][0] >= LEVEL_HOLD_MS) {
        held = true;
        break;
      }
    }
    if (held) return run[i];
  }
  return null;
}

/**
 * Minutes from take-off to the first level-off of the cruise
 * (`firstLevelOff`), inside the take-off's stretch, and only for a real
 * cruise (≥ 3000 m). Without a level-off in the data (too few samples), the
 * first sample at 90 % of the highest altitude. Null when there is no
 * take-off or the climb was broken — never counted from the start of the
 * window, which would add the taxi.
 */
export function climbToCruiseMinutes(series: readonly FlightSample[][]): number | null {
  const top = topAltitude(series);
  if (top === null || top < CRUISE_MIN_ALTITUDE_M) return null;
  const takeoff = takeoffOf(series);
  if (!takeoff) return null;
  const run = series[takeoff.stretch];
  const reached =
    firstLevelOff(run, takeoff.index, top) ??
    run.slice(takeoff.index).find((s) => s[1] !== null && s[1] >= top * CRUISE_SHARE);
  if (!reached) return null;
  return Math.round(((reached[0] - takeoff.tMs) / 60_000) * 10) / 10;
}

/** The samples of one bucket that keep its shape: lowest and highest altitude, top speed. */
function keepersOf(bucket: readonly FlightSample[]): FlightSample[] {
  let low: FlightSample | null = null;
  let high: FlightSample | null = null;
  let fast: FlightSample | null = null;
  for (const s of bucket) {
    if (s[1] !== null && (low === null || s[1] < (low[1] as number))) low = s;
    if (s[1] !== null && (high === null || s[1] > (high[1] as number))) high = s;
    if (s[2] !== null && (fast === null || s[2] > (fast[2] as number))) fast = s;
  }
  const kept = new Set<FlightSample>([bucket[0], ...[low, high, fast].filter((s) => s !== null)]);
  return bucket.filter((s) => kept.has(s));
}

function bucketed(
  series: readonly FlightSample[][],
  t0: number,
  widthMs: number
): FlightSample[][] {
  return series.map((run) => {
    const out: FlightSample[] = [];
    let bucket: FlightSample[] = [];
    let key: number | null = null;
    for (const s of run) {
      const k = Math.floor((s[0] - t0) / widthMs);
      if (key !== null && k !== key) {
        out.push(...keepersOf(bucket));
        bucket = [];
      }
      key = k;
      bucket.push(s);
    }
    if (bucket.length > 0) out.push(...keepersOf(bucket));
    // A stretch's last sample always stays: it is where the line ends, and the
    // map's read of the whole flight is bounded by the series' last instant.
    const last = run[run.length - 1];
    if (last && out[out.length - 1] !== last) out.push(last);
    return out;
  });
}

const sampleCount = (series: readonly FlightSample[][]) =>
  series.reduce((n, run) => n + run.length, 0);

/**
 * At most `max` samples, by time bucket, per stretch: a bucket never spans a
 * break, and each keeps its first sample, its lowest and highest altitude and
 * its top speed, so the apex and the fastest moment survive the thinning; each
 * stretch keeps its first and last sample.
 * Wider buckets are tried until the answer fits (a series of many tiny
 * stretches cannot be thinned below one sample each, so the last resort keeps
 * every stretch's first and last sample only, and past that one sample of
 * evenly chosen stretches — the bound always holds).
 */
export function downsample(
  series: readonly FlightSample[][],
  max: number = FLIGHT_PANEL_MAX_SAMPLES
): FlightSample[][] {
  if (sampleCount(series) <= max) return series.map((run) => [...run]);
  const all = series.flat();
  const t0 = all[0][0];
  const spanMs = Math.max(1, all[all.length - 1][0] - t0);
  let widthMs = Math.max(1, Math.ceil(spanMs / Math.max(1, Math.floor(max / 4))));
  for (let attempt = 0; attempt < 24; attempt++) {
    const out = bucketed(series, t0, widthMs);
    if (sampleCount(out) <= max) return out;
    widthMs *= 2;
  }
  const ends = series.map((run) => (run.length > 2 ? [run[0], run[run.length - 1]] : [...run]));
  if (sampleCount(ends) <= max) return ends;
  // Thousands of breaks: one sample per stretch, evenly chosen, still within
  // the bound — and the very last sample, which bounds the map's read.
  const lastRun = series[series.length - 1];
  const step = series.length / (max - 1);
  return [
    ...Array.from({ length: max - 1 }, (_, i) => [series[Math.floor(i * step)][0]]),
    [lastRun[lastRun.length - 1]],
  ];
}

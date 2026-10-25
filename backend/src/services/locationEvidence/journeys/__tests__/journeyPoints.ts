import type { DerivationPoint } from "../../derivationRead";

/**
 * Synthetic TravTrack derivation points for the journey suites: a stop, a
 * drive at a steady speed, a gap. Not a test file (no `.test.ts` suffix).
 */

export const MIN = 60_000;
/** Degrees of longitude per kilometre at latitude 50°. */
export const LON_PER_KM_AT_50 = 1 / (111.32 * Math.cos((50 * Math.PI) / 180));

let seq = 0;

export function point(atMs: number, lat: number, lon: number, inFlight = false): DerivationPoint {
  seq += 1;
  const key = `${Math.floor(atMs / 1000)}|${lon}|${lat}`;
  return {
    ref: String(seq),
    atMs,
    lat,
    lon,
    accuracyM: 5,
    altitudeM: null,
    speedMps: null,
    courseDeg: null,
    deviceId: "phone-1",
    key,
    digest: `d-${key}`,
    inFlight,
  };
}

/** A stop: a fix every two minutes for `minutes`, all on one spot. */
export function stop(fromMs: number, minutes: number, lat: number, lon: number): DerivationPoint[] {
  const out: DerivationPoint[] = [];
  for (let m = 0; m <= minutes; m += 2) out.push(point(fromMs + m * MIN, lat, lon));
  return out;
}

/**
 * A drive east along latitude `lat` at `kmh`, a fix every two minutes,
 * starting one step after `fromMs` at `lon`.
 */
export function drive(
  fromMs: number,
  minutes: number,
  kmh: number,
  lat: number,
  lon: number,
  opts: { inFlight?: boolean } = {}
): DerivationPoint[] {
  const out: DerivationPoint[] = [];
  const lonPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let m = 2; m <= minutes; m += 2) {
    const km = (kmh * m) / 60;
    out.push(point(fromMs + m * MIN, lat, lon + km * lonPerKm, opts.inFlight));
  }
  return out;
}

/** Stop at A for 30 min, drive `minutes` at `kmh`, stop at the end for 30 min. */
export function stopDriveStop(
  t0: number,
  minutes: number,
  kmh: number,
  lat = 50,
  lon = 8
): DerivationPoint[] {
  const leg = drive(t0 + 30 * MIN, minutes, kmh, lat, lon);
  const last = leg[leg.length - 1];
  return [...stop(t0, 30, lat, lon), ...leg, ...stop(last.atMs + 2 * MIN, 30, last.lat, last.lon)];
}

/**
 * What a stored fix may claim before an everyday figure believes it
 * (forgejo#400). A phone's GPS produces the odd absurd value: 400 m/s in a
 * pocket, an altitude of 12 km in a car park. The year in review, the badges
 * and the movement hints all read speed and height, so the rule lives here
 * once.
 *
 * Speed (`plausibleSpeedMps`): the phone's own `speedMps` counts only when it
 *   - is finite and between 0 and 500 km/h (`MAX_GROUND_KMH`, the ceiling the
 *     monthly kilometres already use: a train is slower, a teleport is not),
 *   - comes with an accuracy no worse than 100 m when one is given,
 *   - does not outrun the movement class the phone itself reported
 *     (`walking` above 10 m/s, `running` 12, `cycling` 25 and `stationary` 5
 *     are the phone contradicting itself).
 * A lone value is judged against its neighbours in `fold.ts`.
 *
 * Altitude (`plausibleAltitudeM`): finite, between the Dead Sea shore
 * (-430 m) and the top of Everest (8850 m, rounded up to 9000), with an
 * accuracy no worse than 100 m when given.
 *
 * Pure: no database, no clock.
 */
import { MAX_GROUND_KMH } from "../months/values";

export const MAX_SPEED_MPS = MAX_GROUND_KMH / 3.6;
export const MAX_FIX_ACCURACY_M = 100;
export const ALTITUDE_MIN_M = -430;
export const ALTITUDE_MAX_M = 9000;

/** Fastest a class the phone named can honestly be, m/s. Absent classes have no cap of their own. */
export const MOTION_SPEED_CAP_MPS: Readonly<Record<string, number>> = {
  stationary: 5,
  walking: 10,
  running: 12,
  cycling: 25,
};

/** The movement classes the phone may report; anything else is read as `unknown`. */
export const MOTION_CLASSES = [
  "walking",
  "running",
  "cycling",
  "automotive",
  "stationary",
  "unknown",
] as const;
export type MotionClass = (typeof MOTION_CLASSES)[number];

export function motionClassOf(motion: string | null): MotionClass {
  return (MOTION_CLASSES as readonly string[]).includes(motion ?? "")
    ? (motion as MotionClass)
    : "unknown";
}

type SpeedFix = { speedMps: number | null; accuracyM: number | null; motion: string | null };

/** The fix's own speed when it is believable, else null (abstains; never 0). */
export function plausibleSpeedMps(fix: SpeedFix): number | null {
  const s = fix.speedMps;
  if (s === null || !Number.isFinite(s) || s < 0 || s > MAX_SPEED_MPS) return null;
  if (fix.accuracyM !== null && fix.accuracyM > MAX_FIX_ACCURACY_M) return null;
  const cap = MOTION_SPEED_CAP_MPS[motionClassOf(fix.motion)];
  if (cap !== undefined && s > cap) return null;
  return s;
}

type AltitudeFix = { altitudeM: number | null; accuracyM: number | null };

export function plausibleAltitudeM(fix: AltitudeFix): number | null {
  const a = fix.altitudeM;
  if (a === null || !Number.isFinite(a) || a < ALTITUDE_MIN_M || a > ALTITUDE_MAX_M) return null;
  if (fix.accuracyM !== null && fix.accuracyM > MAX_FIX_ACCURACY_M) return null;
  return a;
}

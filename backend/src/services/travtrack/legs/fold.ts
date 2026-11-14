import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { STEP_M, STOP_MS } from "../dayMovement";
import { insideWindow, type FixedPlaceWindow } from "../places/window";

/**
 * Folding (spec 2026-11-05-travtrack-fixed-places, S3): a run of fixes inside
 * a fixed place, within its window, or inside a booked lodging between
 * check-in and check-out, is ONE stop at the place's point. A view of the day,
 * never a write: the points stay as they are.
 *
 * Per fix: the smaller circle wins among fixed places, a fixed place beats a
 * lodging. A fix outside every circle (or outside its window) ends the run; a
 * coarse fix is neutral, and so is a fix within `FOLD_BAND_M` outside the
 * circle of the run it interrupts — a phone at the edge of a 150 m circle
 * must not turn one evening into five stops. A run shorter than `STOP_MS` is
 * a pass-by, not a stop.
 */

export const FOLD_BAND_M = 100;

export type FoldPlace = {
  id: string;
  name: string;
  kind: "home" | "work" | "custom";
  lat: number;
  lon: number;
  radiusM: number;
  window: FixedPlaceWindow | null;
  /** The place's own IANA zone; null when none resolves (a window then cannot hold). */
  zone: string | null;
};

export type FoldLodging = {
  stayId: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  fromMs: number;
  untilMs: number;
};

export type FoldContext = {
  places: readonly FoldPlace[];
  lodgings: readonly FoldLodging[];
};

export type FoldTarget =
  { source: "fixed"; place: FoldPlace } | { source: "lodging"; lodging: FoldLodging };

export type FoldRun = {
  from: number;
  to: number;
  fixCount: number;
  target: FoldTarget;
  /** A run shorter than `STOP_MS` kept because it is the device's last word (`findFoldRuns`'s `openEnd`). */
  openEnd?: true;
};

const keyOf = (t: FoldTarget): string =>
  t.source === "fixed" ? `fixed:${t.place.id}` : `lodging:${t.lodging.stayId}`;

const centreOf = (t: FoldTarget) => (t.source === "fixed" ? t.place : t.lodging);
const radiusOf = (t: FoldTarget): number =>
  t.source === "fixed" ? t.place.radiusM : t.lodging.radiusM;

/** Whether the target still holds at this instant (its window, or the booking's span). */
function holdsAt(t: FoldTarget, atMs: number): boolean {
  if (t.source === "lodging") return atMs >= t.lodging.fromMs && atMs <= t.lodging.untilMs;
  const { window, zone } = t.place;
  if (window === null) return true;
  return zone !== null && insideWindow(atMs, zone, window);
}

const pos = (p: StoredPoint) => ({ lat: p[1], lon: p[2] });

/** Smaller radius, then the nearer centre, then the stable id: one answer where circles overlap. */
function tighter(p: StoredPoint, a: FoldTarget, b: FoldTarget): boolean {
  if (radiusOf(a) !== radiusOf(b)) return radiusOf(a) < radiusOf(b);
  const [da, db] = [distanceM(pos(p), centreOf(a)), distanceM(pos(p), centreOf(b))];
  if (da !== db) return da < db;
  return keyOf(a) < keyOf(b);
}

/** The circle a fix folds into, or null. */
export function targetOf(p: StoredPoint, ctx: FoldContext): FoldTarget | null {
  let best: FoldTarget | null = null;
  for (const place of ctx.places) {
    if (distanceM(pos(p), place) > place.radiusM) continue;
    const t: FoldTarget = { source: "fixed", place };
    if (!holdsAt(t, p[0])) continue;
    if (best === null || tighter(p, t, best)) best = t;
  }
  if (best) return best;
  for (const lodging of ctx.lodgings) {
    if (distanceM(pos(p), lodging) > lodging.radiusM) continue;
    const t: FoldTarget = { source: "lodging", lodging };
    if (!holdsAt(t, p[0])) continue;
    if (best === null || tighter(p, t, best)) best = t;
  }
  return best;
}

/**
 * A silence the phone did not announce between two fixes of ONE device that lie at the same
 * spot is a stay, not a gap: a phone at rest sends nothing (measured: five home nights, the
 * last fix before and the first after 16-478 m apart). The ONE verdict, shared by dwells
 * (`stops.ts`), fold runs and the bridge over a track-gap cut.
 *
 * Both fixes need a known accuracy of at most `SILENCE_ACCURACY_M` (a vague fix proves
 * nothing about where the phone was), the silence must be at least `SILENCE_MS` and at most
 * `SILENCE_MAX_MS`, and either the fixes lie within `max(STEP_M, 2 * worse accuracy)` of each
 * other (never more than `SILENCE_SEPARATION_CAP_M`), or both lie inside the same fixed place
 * (its radius plus `FOLD_BAND_M`) while that place holds. A fix further away than that stays a
 * departure: 478 m at 3 m accuracy is not noise.
 */
export const SILENCE_MS = STOP_MS;
export const SILENCE_MAX_MS = 24 * 60 * 60_000;
export const SILENCE_ACCURACY_M = 50;
export const SILENCE_SEPARATION_CAP_M = 100;

export function stationarySilence(
  a: StoredPoint,
  b: StoredPoint,
  places: readonly FoldPlace[]
): boolean {
  const dt = b[0] - a[0];
  if (dt < SILENCE_MS || dt > SILENCE_MAX_MS) return false;
  if (a[3] === null || b[3] === null || a[3] > SILENCE_ACCURACY_M || b[3] > SILENCE_ACCURACY_M)
    return false;
  const reach = Math.min(SILENCE_SEPARATION_CAP_M, Math.max(STEP_M, 2 * Math.max(a[3], b[3])));
  if (distanceM(pos(a), pos(b)) <= reach) return true;
  return places.some((place) => {
    const t: FoldTarget = { source: "fixed", place };
    const within = (p: StoredPoint) =>
      holdsAt(t, p[0]) && distanceM(pos(p), place) <= place.radiusM + FOLD_BAND_M;
    return within(a) && within(b);
  });
}

/**
 * The last word of a device: at least two fixes inside a FIXED place, the final one of known
 * accuracy. It shows "at Home since ..." before `STOP_MS` has passed since arriving, which is
 * all the current day can say: nothing follows the last fix.
 */
function isArrival(segment: readonly StoredPoint[], run: FoldRun): boolean {
  const last = segment[run.to];
  return (
    run.target.source === "fixed" &&
    run.fixCount >= 2 &&
    last[3] !== null &&
    last[3] <= SILENCE_ACCURACY_M
  );
}

export function findFoldRuns(
  segment: readonly StoredPoint[],
  ctx: FoldContext,
  isBad: (p: StoredPoint) => boolean,
  /** The stretch is the device's last: its final run may be shorter than `STOP_MS` (current day). */
  openEnd = false
): FoldRun[] {
  if (ctx.places.length === 0 && ctx.lodgings.length === 0) return [];
  const out: FoldRun[] = [];
  let run: FoldRun | null = null;
  const close = (final = false) => {
    const long = run !== null && segment[run.to][0] - segment[run.from][0] >= STOP_MS;
    if (run && final && openEnd && (long || isArrival(segment, run)))
      out.push({ ...run, openEnd: true });
    else if (run && long) out.push(run);
    run = null;
  };
  for (let i = 0; i < segment.length; i++) {
    const p = segment[i];
    if (isBad(p)) continue;
    const target = targetOf(p, ctx);
    if (target && run && keyOf(target) === keyOf(run.target)) {
      run.to = i;
      run.fixCount += 1;
      continue;
    }
    if (
      !target &&
      run &&
      holdsAt(run.target, p[0]) &&
      distanceM(pos(p), centreOf(run.target)) <= radiusOf(run.target) + FOLD_BAND_M
    ) {
      // The phone fell silent at the place and spoke again a little off it: still the stay.
      if (
        run.target.source === "fixed" &&
        stationarySilence(segment[run.to], p, [run.target.place])
      ) {
        run.to = i;
        run.fixCount += 1;
      }
      continue;
    }
    close();
    if (target) run = { from: i, to: i, fixCount: 1, target };
  }
  close(true);
  return out;
}

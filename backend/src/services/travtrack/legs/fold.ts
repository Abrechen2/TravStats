import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { STOP_MS } from "../dayMovement";
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

export type FoldRun = { from: number; to: number; fixCount: number; target: FoldTarget };

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

/** The circle a fix folds into, or null. */
function targetOf(p: StoredPoint, ctx: FoldContext): FoldTarget | null {
  let best: FoldTarget | null = null;
  for (const place of ctx.places) {
    if (distanceM(pos(p), place) > place.radiusM) continue;
    const t: FoldTarget = { source: "fixed", place };
    if (!holdsAt(t, p[0])) continue;
    if (best === null || place.radiusM < radiusOf(best)) best = t;
  }
  if (best) return best;
  for (const lodging of ctx.lodgings) {
    if (distanceM(pos(p), lodging) > lodging.radiusM) continue;
    const t: FoldTarget = { source: "lodging", lodging };
    if (!holdsAt(t, p[0])) continue;
    if (best === null || lodging.radiusM < radiusOf(best)) best = t;
  }
  return best;
}

export function findFoldRuns(
  segment: readonly StoredPoint[],
  ctx: FoldContext,
  isBad: (p: StoredPoint) => boolean
): FoldRun[] {
  if (ctx.places.length === 0 && ctx.lodgings.length === 0) return [];
  const out: FoldRun[] = [];
  let run: FoldRun | null = null;
  const close = () => {
    if (run && segment[run.to][0] - segment[run.from][0] >= STOP_MS) out.push(run);
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
    )
      continue;
    close();
    if (target) run = { from: i, to: i, fixCount: 1, target };
  }
  close();
  return out;
}

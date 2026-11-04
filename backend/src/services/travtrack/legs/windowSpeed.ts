import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM } from "../classify";
import { MAX_SPEED_MPS } from "../everyday/plausible";
import { STEP_MAX_MS } from "../everyday/fold";
import { isBadVertex } from "./stops";

/**
 * Glitch-safe speeds from fixes alone. A phone at 1 Hz and 20 m accuracy puts
 * a fix every second inside its own error circle, so the speed of one step is
 * noise (measured: a 40-minute walk with single steps at 43 m/s). The speed of
 * a WINDOW is the displacement between its first and last fix over its time:
 * jitter that goes back and forth cancels, a glitch is diluted by the window.
 *
 * A window closes once it spans `WINDOW_MS` and has moved at least
 * `WINDOW_ACCURACY_FACTOR` times the worse accuracy of its two ends; a window
 * that stays small (standing still) is closed at `WINDOW_MAX_MS` regardless.
 * Sparse data (a step of `WINDOW_MS` or more) is never merged with its
 * neighbours: it yields one-step windows, i.e. the plain step speed.
 */
export const WINDOW_MS = 30_000;
export const WINDOW_MAX_MS = 90_000;
export const WINDOW_ACCURACY_FACTOR = 2;

export type SpeedWindow = {
  mps: number;
  ms: number;
  /** The fix that closes the window, when the window is a single step (else null). */
  single: StoredPoint | null;
};

/**
 * The windows of a stretch, or null for a stretch that cannot be judged here.
 * A bad fix is skipped, a gap over `STEP_MAX_MS` restarts the window, a window
 * faster than any ground vehicle is dropped.
 */
export function speedWindows(points: readonly StoredPoint[]): SpeedWindow[] {
  const out: SpeedWindow[] = [];
  let anchor: StoredPoint | null = null;
  let anchorIdx = -1;
  let prev: StoredPoint | null = null;
  points.forEach((p, i) => {
    if (isBadVertex(p)) return;
    if (prev && (p[0] - prev[0] > STEP_MAX_MS || p[0] <= prev[0])) anchor = null;
    // A step that spans a window on its own is a sparse fix, judged alone: merging it with
    // its neighbour would blur a stop into a walking pace.
    else if (prev && anchor && p[0] - prev[0] >= WINDOW_MS) {
      anchor = prev;
      anchorIdx = i - 1;
    }
    prev = p;
    if (!anchor) {
      anchor = p;
      anchorIdx = i;
      return;
    }
    const ms = p[0] - anchor[0];
    const metres = distanceM({ lat: anchor[1], lon: anchor[2] }, { lat: p[1], lon: p[2] });
    const noise = WINDOW_ACCURACY_FACTOR * Math.max(anchor[3] ?? 0, p[3] ?? 0);
    const sparse = i - anchorIdx === 1 && ms >= WINDOW_MS;
    if (!sparse && (ms < WINDOW_MS || (metres < noise && ms < WINDOW_MAX_MS))) return;
    const mps = metres / (ms / 1000);
    if (mps <= MAX_SPEED_MPS) out.push({ mps, ms, single: i - anchorIdx === 1 ? p : null });
    anchor = p;
    anchorIdx = i;
  });
  return out;
}

/** The fastest believable window, or null where there is none. */
export function topWindowSpeedMps(points: readonly StoredPoint[]): number | null {
  const speeds = speedWindows(points).map((w) => w.mps);
  return speeds.length > 0 ? Math.max(...speeds) : null;
}

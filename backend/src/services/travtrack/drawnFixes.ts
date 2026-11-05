import { privacySafeStretches } from "../tripRecording/privacySafe";
import type { StoredPoint } from "../tripRecording/segments";
import { isBadFix } from "../locationEvidence/anomaly";
import { MAX_DRAWN_ACCURACY_M } from "./legs/stops";
import type { SafeSpan } from "./readSafe";

/**
 * The read as it is DRAWN: every fix `isBadVertex` rejects (an accuracy worse
 * than `MAX_DRAWN_ACCURACY_M`, null island) is left out of the stretches, so a
 * cell-tower fallback is not a spike on the map. The kept vertices are the
 * very tuples read, so `rowOf` (and with it `pointIds`, `pointDetails` and the
 * legs' `ranges`) stays aligned with what is returned. Storage and export
 * keep the raw points; this is a verdict on the view.
 *
 * A coarse fix is only dropped where finer fixes exist in the same stretch: an account
 * whose fixes are ALL coarse (a phone without GPS permission, a Wi-Fi-only
 * device) would otherwise draw nothing at all, while a cell-tower position
 * 1.5 km off is still better than a blank day. Null island and the like
 * (`isBadFix`) are never drawn.
 */
export function withoutBadVertices<T extends Pick<SafeSpan, "segments" | "circles">>(read: T): T {
  // Dropping a vertex makes a chord the raw points never had, and one may cross a zone:
  // the privacy cut is applied once more on the result (as the range view does).
  const valid = read.segments.map((s): StoredPoint[] =>
    s.filter((p) => !isBadFix({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] }))
  );
  const isCoarse = (p: StoredPoint) => p[3] !== null && p[3] > MAX_DRAWN_ACCURACY_M;
  // Per stretch, not per read: a range read spans days, and a coarse-only day must not
  // vanish because another day in the same read has a fine fix.
  const segments = privacySafeStretches(
    valid.map((s) => (s.some((p) => !isCoarse(p)) ? s.filter((p) => !isCoarse(p)) : s)),
    read.circles
  ).filter((s) => s.length > 0);
  return { ...read, segments };
}

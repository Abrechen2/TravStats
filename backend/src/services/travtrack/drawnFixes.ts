import { privacySafeStretches } from "../tripRecording/privacySafe";
import type { StoredPoint } from "../tripRecording/segments";
import { isBadVertex } from "./legs/stops";
import type { SafeSpan } from "./readSafe";

/**
 * The read as it is DRAWN: every fix `isBadVertex` rejects (an accuracy worse
 * than `MAX_DRAWN_ACCURACY_M`, null island) is left out of the stretches, so a
 * cell-tower fallback is not a spike on the map. The kept vertices are the
 * very tuples read, so `rowOf` (and with it `pointIds`, `pointDetails` and the
 * legs' `ranges`) stays aligned with what is returned. Storage and export
 * keep the raw points; this is a verdict on the view.
 */
export function withoutBadVertices<T extends Pick<SafeSpan, "segments" | "circles">>(read: T): T {
  // Dropping a vertex makes a chord the raw points never had, and one may cross a zone:
  // the privacy cut is applied once more on the result (as the range view does).
  const segments = privacySafeStretches(
    read.segments.map((s): StoredPoint[] => s.filter((p) => !isBadVertex(p))),
    read.circles
  ).filter((s) => s.length > 0);
  return { ...read, segments };
}

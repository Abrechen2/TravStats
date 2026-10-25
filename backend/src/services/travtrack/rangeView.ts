import { simplifyDegrees } from "../schematicRouter";
import { privacySafeStretches } from "../tripRecording/privacySafe";
import type { StoredPoint } from "../tripRecording/segments";
import { formatSafeCursor, readSafeTravTrack, type SafeCursor, type Span } from "./readSafe";

/**
 * A span of the history for the map's Monat / Jahr / Zeitraum (TravTrack plan
 * T5.3): the privacy-safe stretches (`readSafe.ts` — cut at every gap,
 * deleted span, pause and privacy zone), simplified to at most
 * `RANGE_VERTEX_CAP` vertices per answer, then privacy-cut ONCE MORE on the
 * simplified geometry: dropping vertices makes chords the raw points never
 * had, and one may cross a zone.
 *
 * Bounded twice: a part reads at most `RANGE_READ_CAP` points, and a span is
 * at most `RANGE_MAX_DAYS` long (the schema). A part that did not reach the
 * span's end names `next` and `cursor`; the client asks again with the cursor.
 * A part's end ends every stretch in it — stretches of two parts are never
 * joined, so the one step across a part boundary is not drawn.
 *
 * Every vertex is a stored point, and `pointIds` names it (aligned with
 * `segments`), so the inspector can delete exactly that one.
 */

export const RANGE_READ_CAP = 50_000;
export const RANGE_VERTEX_CAP = 10_000;
/** ≈ 1 m; doubled until the part fits the vertex cap. */
const START_TOLERANCE_DEG = 0.00001;
const MAX_DOUBLINGS = 30;

export type TravTrackRange = {
  from: string;
  to: string;
  segments: StoredPoint[][];
  /** The stored point of each vertex, aligned with `segments`. */
  pointIds: string[][];
  /** Vertices given. */
  pointCount: number;
  /** Privacy-safe vertices this part read, before simplifying. */
  readCount: number;
  /** Whether vertices were dropped to fit the cap. */
  simplified: boolean;
  /** Stretches left out because even two vertices each would not fit; 0 normally. */
  omittedSegments: number;
  /** The first instant not read, or null when the span ends in this part. */
  next: string | null;
  /** Where the next part continues (`<tMs>:<seq>`), or null. */
  cursor: string | null;
};

const vertexCount = (lines: readonly StoredPoint[][]) => lines.reduce((n, l) => n + l.length, 0);

/** One stretch simplified on its coordinates; the kept vertices are the very tuples given. */
function simplifyStretch(line: readonly StoredPoint[], tolerance: number): StoredPoint[] {
  const coords = line.map((p): [number, number] => [p[2], p[1]]);
  const at = new Map(coords.map((c, i) => [c, i]));
  return simplifyDegrees(coords, tolerance).map((c) => line[at.get(c) as number]);
}

/** The stretches within `cap` vertices: unchanged when they fit, else simplified harder each round. */
export function simplifyStretchesWithin(
  lines: readonly StoredPoint[][],
  cap: number
): { lines: StoredPoint[][]; simplified: boolean; omitted: number } {
  if (vertexCount(lines) <= cap)
    return { lines: lines.map((l) => [...l]), simplified: false, omitted: 0 };
  let tolerance = START_TOLERANCE_DEG;
  let out = lines.map((l) => simplifyStretch(l, tolerance));
  for (let k = 0; vertexCount(out) > cap && k < MAX_DOUBLINGS; k++) {
    tolerance *= 2;
    out = lines.map((l) => simplifyStretch(l, tolerance));
  }
  if (vertexCount(out) <= cap) return { lines: out, simplified: true, omitted: 0 };
  // More stretches than the cap holds even at two vertices each: the longest
  // stay, and the answer says how many did not.
  const ranked = [...out].sort((a, b) => b.length - a.length);
  const kept: StoredPoint[][] = [];
  let n = 0;
  for (const line of ranked) {
    if (n + line.length > cap) continue;
    kept.push(line);
    n += line.length;
  }
  kept.sort((a, b) => a[0][0] - b[0][0]);
  return { lines: kept, simplified: true, omitted: out.length - kept.length };
}

export async function travTrackRange(
  userId: string,
  window: Span,
  after: SafeCursor | null,
  caps: { read?: number; vertices?: number } = {}
): Promise<TravTrackRange> {
  const read = await readSafeTravTrack(userId, window, caps.read ?? RANGE_READ_CAP, after);
  const fitted = simplifyStretchesWithin(read.segments, caps.vertices ?? RANGE_VERTEX_CAP);
  // The check that counts: on the geometry as it leaves.
  const segments = privacySafeStretches(fitted.lines, read.circles).filter((s) => s.length > 0);
  const pointIds = segments.map((s) => s.map((p) => read.rowOf(p)?.id ?? ""));
  if (pointIds.some((ids) => ids.includes(""))) {
    // Every vertex is a tuple the read made; one without its row is a bug, not data.
    throw new Error("travtrack range: a vertex lost its point");
  }
  return {
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.untilMs).toISOString(),
    segments,
    pointIds,
    pointCount: vertexCount(segments),
    readCount: vertexCount(read.segments),
    simplified: fitted.simplified,
    omittedSegments: fitted.omitted,
    next: read.next ? read.next.toISOString() : null,
    cursor: read.cursor ? formatSafeCursor(read.cursor) : null,
  };
}

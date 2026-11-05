import type { TrackPoint } from "../../../lib/api/travtrack";

/** A stop whose fixes the server folded into one place point. */
export interface FoldedSpan {
  fromMs: number;
  untilMs: number;
  lat: number;
  lon: number;
}

/**
 * Everything inside a fixed place's (or lodging's) radius shows as ONE point
 * (owner, 2026-11-05): the line enters the place point and leaves from it. The
 * fixes inside the folded span are replaced by the place point at the span's
 * start and its end, so the time spent there survives for speed colouring and
 * the line stays one stretch. The stored fixes are untouched: the Points layer
 * and the point inspector read the raw segments.
 */
export function collapseFolded(
  segments: readonly TrackPoint[][],
  spans: readonly FoldedSpan[]
): TrackPoint[][] {
  if (spans.length === 0) return segments.map((s) => s);
  return segments.map((segment) => {
    const out: TrackPoint[] = [];
    const emitted = new Set<FoldedSpan>();
    for (const point of segment) {
      const span = spans.find((s) => point[0] >= s.fromMs && point[0] <= s.untilMs);
      if (!span) {
        out.push(point);
        continue;
      }
      if (emitted.has(span)) continue;
      emitted.add(span);
      out.push([span.fromMs, span.lat, span.lon, null], [span.untilMs, span.lat, span.lon, null]);
    }
    return out;
  });
}

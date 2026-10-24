import type { ZoneCircle } from "./classify";
import { privacyCut, type LonLat } from "./privacyCut";

/**
 * A stored line in the `geometry` + `segmentStarts` shape (flight tracks, the
 * map's track lines), privacy-cut on its final form and put back into that
 * shape (TravTrack plan T5).
 */
export function cutGeometry(
  geometry: readonly LonLat[],
  segmentStarts: readonly number[],
  circles: readonly ZoneCircle[]
): { geometry: LonLat[]; segmentStarts: number[] } {
  if (circles.length === 0) return { geometry: [...geometry], segmentStarts: [...segmentStarts] };
  const starts = [...new Set([0, ...segmentStarts])]
    .filter((i) => i < geometry.length)
    .sort((a, b) => a - b);
  const lines = starts.map((start, k) => geometry.slice(start, starts[k + 1] ?? geometry.length));
  const cut = privacyCut(lines, circles);
  const out: LonLat[] = [];
  const outStarts: number[] = [];
  for (const line of cut) {
    outStarts.push(out.length);
    out.push(...line);
  }
  return { geometry: out, segmentStarts: outStarts };
}

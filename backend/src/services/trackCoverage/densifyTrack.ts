import { haversineKm } from "../../shared/geo/haversine";
import type { StoredTrack } from "./storedTrack";

/**
 * A stored recording with extra vertices interpolated ON its own line, so no
 * two consecutive vertices of one recording segment are further apart than
 * `maxStepKm`.
 *
 * Why: the stored line is simplified, and Douglas-Peucker keeps only the
 * vertices where the course bends. A ship that sails straight past a port —
 * or straight into it — leaves no vertex anywhere near the port, and a check
 * that only looks at vertices then reports "never reached" for a recording
 * that ran right through it (measured in `cruiseTracks.test.ts`: a straight
 * three-port voyage simplifies to its two ends). The interpolated points claim
 * nothing the stored line does not already draw.
 *
 * A hole between two recording segments is NOT filled: the chord across it is
 * not a recording, and must not count as having reached a port.
 */
export interface DenseTrack {
  geometry: Array<[number, number]>;
  /** True where the vertex is one of the stored line's own. */
  original: boolean[];
  /** Segment starts, re-indexed into the dense line. */
  segmentStarts: number[];
  /** Running raw distance, interpolated along with the line; null if absent. */
  cumulativeKm: number[] | null;
}

export function densifyTrack(track: StoredTrack, maxStepKm: number): DenseTrack {
  const { geometry, cumulativeKm } = track;
  const starts = new Set(track.segmentStarts ?? [0]);
  const dense: DenseTrack = {
    geometry: [],
    original: [],
    segmentStarts: [],
    cumulativeKm: cumulativeKm === null ? null : [],
  };

  for (let i = 0; i < geometry.length; i++) {
    if (starts.has(i) || i === 0) dense.segmentStarts.push(dense.geometry.length);
    dense.geometry.push(geometry[i]);
    dense.original.push(true);
    dense.cumulativeKm?.push(cumulativeKm![i]);

    const next = i + 1;
    if (next >= geometry.length || starts.has(next)) continue;
    const [lonA, latA] = geometry[i];
    const [lonB, latB] = geometry[next];
    // Across the antimeridian a linear step in longitude runs the long way
    // round; such a step is left as it is rather than drawn around the globe.
    if (Math.abs(lonB - lonA) > 180) continue;
    const km = haversineKm({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
    const pieces = Math.ceil(km / maxStepKm);
    for (let j = 1; j < pieces; j++) {
      const f = j / pieces;
      dense.geometry.push([lonA + (lonB - lonA) * f, latA + (latB - latA) * f]);
      dense.original.push(false);
      dense.cumulativeKm?.push(cumulativeKm![i] + (cumulativeKm![next] - cumulativeKm![i]) * f);
    }
  }
  return dense;
}

import type { FlightTrackPieces } from "../../types/flightTrack";

export type { FlightTrackPieces };

/** Degrees of margin around the line, so its ends never sit on the frame. */
const BOUNDS_PAD_DEG = 0.5;

type LonLat = [number, number];

/** Each step kept under 180°, so a flight across the date line stays one line. */
function unwrapLongitudes(geometry: readonly LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (const [lon, lat] of geometry) {
    const prev = out[out.length - 1];
    let next = lon;
    if (prev) {
      while (next - prev[0] > 180) next -= 360;
      while (next - prev[0] < -180) next += 360;
    }
    out.push([next, lat]);
  }
  return out;
}

/**
 * The recording split into measured stretches and the connectors across the
 * holes between them (forgejo#312). Every fix stays on the drawing: a phone
 * in a cabin often holds a fix for one sample only, and dropping those
 * one-point stretches left 24 of LH719's first 25 fixes off the map. No curve
 * is invented across a hole — the connector is the straight step between the
 * two fixes either side of it.
 *
 * Longitudes are unwrapped over the whole line, holes included, so a flight
 * across the date line draws as one continuous line.
 */
export function flightTrackPieces(
  geometry: readonly LonLat[],
  segmentStarts: readonly number[]
): FlightTrackPieces {
  const unwrapped = unwrapLongitudes(geometry);
  const starts = [...new Set([0, ...segmentStarts])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < unwrapped.length)
    .sort((a, b) => a - b);
  const stretches = starts.map((start, i) =>
    unwrapped.slice(start, starts[i + 1] ?? unwrapped.length)
  );

  const gaps: LonLat[][] = [];
  for (let i = 0; i + 1 < stretches.length; i++) {
    const from = stretches[i][stretches[i].length - 1];
    const to = stretches[i + 1][0];
    // A one-fix stretch between two holes: the previous connector ends on it,
    // so this one carries straight on from there.
    if (i > 0 && stretches[i].length === 1) gaps[gaps.length - 1].push(to);
    else gaps.push([from, to]);
  }
  return { solid: stretches.filter((s) => s.length >= 2), gaps };
}

/** Every drawn line of the pieces, solid and connector alike. */
export function allTrackLines(pieces: FlightTrackPieces): LonLat[][] {
  return [...pieces.solid, ...pieces.gaps];
}

/** `[[west, south], [east, north]]` around every drawn point, or null with none. */
export function flightTrackBounds(
  paths: readonly LonLat[][]
): [[number, number], [number, number]] | null {
  const points = paths.flat();
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons) - BOUNDS_PAD_DEG, Math.max(-90, Math.min(...lats) - BOUNDS_PAD_DEG)],
    [Math.max(...lons) + BOUNDS_PAD_DEG, Math.min(90, Math.max(...lats) + BOUNDS_PAD_DEG)],
  ];
}

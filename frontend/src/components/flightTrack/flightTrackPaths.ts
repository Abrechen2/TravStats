/** Degrees of margin around the line, so its ends never sit on the frame. */
const BOUNDS_PAD_DEG = 0.5;

type LonLat = [number, number];

/**
 * The recording split into the stretches the phone actually recorded. The gap
 * between two of them had no fix and is NOT drawn — a straight line across it
 * would be the one part of the picture nobody recorded.
 *
 * Longitudes are unwrapped (each step kept under 180°), so a flight across the
 * date line draws as one continuous arc instead of a stroke around the globe.
 */
export function flightTrackPaths(
  geometry: readonly LonLat[],
  segmentStarts: readonly number[]
): LonLat[][] {
  const starts = [...new Set([0, ...segmentStarts])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < geometry.length)
    .sort((a, b) => a - b);

  const unwrapped: LonLat[] = [];
  for (const [lon, lat] of geometry) {
    const prev = unwrapped[unwrapped.length - 1];
    let next = lon;
    if (prev) {
      while (next - prev[0] > 180) next -= 360;
      while (next - prev[0] < -180) next += 360;
    }
    unwrapped.push([next, lat]);
  }

  return starts
    .map((start, i) => unwrapped.slice(start, starts[i + 1] ?? unwrapped.length))
    .filter((path) => path.length >= 2);
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

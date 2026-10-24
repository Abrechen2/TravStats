import { distanceM, type ZoneCircle } from "./classify";

/**
 * The final-output privacy check (TravTrack plan T5, review focus 10 and 15):
 * run on a line as it LEAVES the server — after jitter removal and after any
 * simplification, never before. Simplification can make a chord the raw
 * points never had, so checking only the input would miss it.
 *
 *   - every vertex inside a circle is dropped;
 *   - the line is broken wherever the chord between two consecutive output
 *     vertices passes within a circle. Two checks, either suffices: the
 *     great-circle segment (exact cross-track distance) and the straight
 *     line a web map draws between the two in longitude/latitude.
 *
 * The circles are the privacy zones that apply to the line (and, for a
 * shared route, the home circle). A piece left with a single vertex draws
 * nothing and is dropped.
 */

export type LonLat = [number, number];

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lon - a.lon);
  return Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  );
}

/** Distance from `c` to the great-circle segment a–b, in metres. */
function greatCircleDistance(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  c: { lat: number; lon: number }
): number {
  const d13 = distanceM(a, c) / R;
  const d12 = distanceM(a, b) / R;
  if (d12 === 0) return d13 * R;
  const dxt = Math.asin(Math.sin(d13) * Math.sin(bearing(a, c) - bearing(a, b)));
  const dat = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(dxt))));
  // Beyond either end of the segment: the nearer endpoint is the nearest point.
  if (Math.cos(bearing(a, c) - bearing(a, b)) < 0 || dat > d12) {
    return Math.min(d13 * R, distanceM(b, c));
  }
  return Math.abs(dxt) * R;
}

/** Distance from `c` to the straight lon/lat line a–b as a map draws it, in metres. */
function mapLineDistance(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  c: { lat: number; lon: number }
): number {
  // A chord across the antimeridian is not drawn as a short straight line; the
  // great-circle check covers it.
  if (Math.abs(b.lon - a.lon) > 180) return Infinity;
  const k = Math.cos(rad(c.lat));
  const ax = (a.lon - c.lon) * k;
  const ay = a.lat - c.lat;
  const bx = (b.lon - c.lon) * k;
  const by = b.lat - c.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const s = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
  const nearest = { lon: a.lon + s * (b.lon - a.lon), lat: a.lat + s * (b.lat - a.lat) };
  return distanceM(nearest, c);
}

export function segmentCrossesZone(a: LonLat, b: LonLat, circle: ZoneCircle): boolean {
  const pa = { lon: a[0], lat: a[1] };
  const pb = { lon: b[0], lat: b[1] };
  return (
    greatCircleDistance(pa, pb, circle) <= circle.radiusM ||
    mapLineDistance(pa, pb, circle) <= circle.radiusM
  );
}

const inside = (p: LonLat, circles: readonly ZoneCircle[]) =>
  circles.some((c) => distanceM({ lon: p[0], lat: p[1] }, c) <= c.radiusM);

/**
 * `privacyCut` over any vertex type (a GPX keeps its timestamps): `coord`
 * reads the vertex's `[lon, lat]`.
 */
export function privacyCutBy<T>(
  lines: readonly T[][],
  circles: readonly ZoneCircle[],
  coord: (vertex: T) => LonLat
): T[][] {
  if (circles.length === 0) return lines.filter((l) => l.length > 1).map((l) => [...l]);
  const out: T[][] = [];
  for (const line of lines) {
    let current: T[] = [];
    for (const vertex of line) {
      if (inside(coord(vertex), circles)) {
        if (current.length > 1) out.push(current);
        current = [];
        continue;
      }
      const last = current[current.length - 1];
      if (last && circles.some((c) => segmentCrossesZone(coord(last), coord(vertex), c))) {
        if (current.length > 1) out.push(current);
        current = [];
      }
      current.push(vertex);
    }
    if (current.length > 1) out.push(current);
  }
  return out;
}

export function privacyCut(
  lines: readonly LonLat[][],
  zones: readonly ZoneCircle[],
  opts: { homeM?: number; home?: { lat: number; lon: number } | null } = {}
): LonLat[][] {
  const circles =
    opts.home && opts.homeM ? [...zones, { ...opts.home, radiusM: opts.homeM }] : [...zones];
  return privacyCutBy(lines, circles, (p) => p);
}

import type { MapPoint } from "./types";

/**
 * The trip's route as an inline SVG: no tiles, no request, nothing that can
 * disappear in thirty years. An equirectangular projection with the longitude
 * scaled by cos(mid latitude), fitted to the width. A trip across the
 * antimeridian is drawn the long way round — a schematic, not a chart.
 */

const WIDTH = 760;
const MAX_HEIGHT = 420;
const PAD = 28;
/** Numbered points on the map and rows in the legend. */
export const MAX_MAP_POINTS = 60;

export interface MapResult {
  svg: string;
  /** The numbered points, in legend order. */
  listed: MapPoint[];
  /** Points beyond the cap. */
  omitted: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function pointKey(p: MapPoint): string {
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
}

export function buildMap(
  points: MapPoint[],
  legs: Array<[MapPoint, MapPoint]>,
  escape: (s: string) => string
): MapResult | null {
  const unique: MapPoint[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    if (seen.has(pointKey(p))) continue;
    seen.add(pointKey(p));
    unique.push(p);
  }
  if (unique.length === 0) return null;
  const listed = unique.slice(0, MAX_MAP_POINTS);

  const lats = unique.map((p) => p.lat);
  const lons = unique.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180) || 1;
  const spanX = Math.max((maxLon - minLon) * k, 0.5);
  const spanY = Math.max(maxLat - minLat, 0.5);
  const scale = Math.min((WIDTH - 2 * PAD) / spanX, (MAX_HEIGHT - 2 * PAD) / spanY);
  const width = WIDTH;
  const height = Math.round(spanY * scale + 2 * PAD);
  const offX = (width - spanX * scale) / 2;
  const project = (p: MapPoint): [number, number] => [
    round1(offX + (p.lon - minLon) * k * scale),
    round1(PAD + (maxLat - p.lat) * scale),
  ];

  const lines = legs
    .map(([a, b]) => {
      const [x1, y1] = project(a);
      const [x2, y2] = project(b);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    })
    .join("");
  const dots = listed
    .map((p, i) => {
      const [x, y] = project(p);
      return (
        `<circle cx="${x}" cy="${y}" r="9"/>` +
        `<text x="${x}" y="${round1(y + 3.5)}" text-anchor="middle">${i + 1}</text>`
      );
    })
    .join("");
  // Points past the cap are drawn small and unnumbered so the route stays whole.
  const rest = unique
    .slice(MAX_MAP_POINTS)
    .map((p) => {
      const [x, y] = project(p);
      return `<circle cx="${x}" cy="${y}" r="2.5" class="minor"/>`;
    })
    .join("");
  const label = escape(listed.map((p, i) => `${i + 1} ${p.label}`).join(", "));
  const svg =
    `<svg class="map" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-label="${label}"><rect width="${width}" height="${height}" class="sea"/>` +
    `<g class="legs">${lines}</g><g class="dots">${rest}${dots}</g></svg>`;
  return { svg, listed, omitted: unique.length - listed.length };
}

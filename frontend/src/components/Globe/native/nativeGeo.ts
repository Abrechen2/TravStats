// Small pure helpers for the globe's native MapLibre layers (forgejo#331).

import type { Feature, LineString, Point, Polygon } from "geojson";

export type LngLat = readonly [number, number];
export type NativeFeature<G extends LineString | Point | Polygon = LineString | Point | Polygon> =
  Feature<G, Record<string, string | number | boolean>>;

/** `[r,g,b,a]` (alpha 0-255, as deck.gl takes it) as a CSS colour MapLibre parses. */
export function cssRgba(color: readonly number[], fallbackAlpha = 255): string {
  const a = color.length > 3 ? color[3] : fallbackAlpha;
  const alpha = Math.round((Math.max(0, Math.min(255, a)) / 255) * 1000) / 1000;
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha})`;
}

const wrapLng = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180;

/**
 * Cut a path wherever it crosses the anti-meridian, so MapLibre does not draw
 * the segment the long way round the sphere (a native line is a straight
 * segment in lng/lat, unlike deck.gl's pre-unwrapped waypoints). A crossing
 * ends one piece at ±180 and starts the next at ∓180 on the same latitude.
 * Pieces of fewer than two points are dropped.
 */
export function splitAtAntimeridian(path: readonly LngLat[]): [number, number][][] {
  const pieces: [number, number][][] = [];
  let current: [number, number][] = [];
  let prev: [number, number] | null = null; // wrapped
  for (const point of path) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const here: [number, number] = [wrapLng(point[0]), point[1]];
    if (prev && Math.abs(here[0] - prev[0]) > 180) {
      const edge = prev[0] > 0 ? 180 : -180;
      // `here` re-expressed on the same side as `prev`, to interpolate across.
      const hereUnwrapped = here[0] + (prev[0] > 0 ? 360 : -360);
      const span = hereUnwrapped - prev[0];
      const t = span === 0 ? 0 : (edge - prev[0]) / span;
      const lat = prev[1] + (here[1] - prev[1]) * t;
      current.push([edge, lat]);
      if (current.length >= 2) pieces.push(current);
      current = [[-edge, lat]];
    }
    current.push(here);
    prev = here;
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

export function lineFeatures(
  path: readonly LngLat[],
  props: Record<string, string | number | boolean>,
  firstId: number
): { features: NativeFeature<LineString>[]; nextId: number } {
  let id = firstId;
  const features = splitAtAntimeridian(path).map((coordinates) => ({
    type: "Feature" as const,
    id: id++,
    properties: props,
    geometry: { type: "LineString" as const, coordinates },
  }));
  return { features, nextId: id };
}

export function pointFeature(
  position: LngLat,
  props: Record<string, string | number | boolean>,
  id: number
): NativeFeature<Point> {
  return {
    type: "Feature",
    id,
    properties: props,
    geometry: { type: "Point", coordinates: [position[0], position[1]] },
  };
}

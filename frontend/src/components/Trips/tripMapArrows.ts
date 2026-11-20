// Direction arrows for the trip map's journey lines: one chevron at the middle
// of each line, turned the way the journey went. Without them a flight and its
// return leg are the same line.
//
// Flat map only. deck.gl's billboard layers draw nothing under globe projection
// (the same constraint as the text layers — see TripMapGlobeLayers.ts), so the
// globe keeps its plain lines.

import { IconLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { LayerGroup } from "./tripMapGroups";

export interface DirectionLine {
  id: string;
  /** The legend group the line belongs to, so hiding the group hides its arrow. */
  group: LayerGroup;
  /** `[lon, lat]` waypoints in travel order. */
  path: readonly [number, number][];
  color: [number, number, number];
  dim?: boolean;
}

export interface ArrowDatum {
  position: [number, number];
  /** Compass bearing in degrees, clockwise from north. */
  bearing: number;
  color: [number, number, number];
  dim: boolean;
  /** A point a little further along the line, so a projection can turn the arrow on screen. */
  ahead: [number, number];
}

const RAD = Math.PI / 180;
const EARTH_M = 6371000;

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `a` to `b`, 0-360. */
export function bearingBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * The arrow for one line, `fraction` of the way along it (the middle by
 * default); null for a line that goes nowhere.
 */
export function arrowFor(line: DirectionLine, fraction = 0.5): ArrowDatum | null {
  const pts = line.path;
  if (pts.length < 2) return null;
  const lengths = pts.slice(1).map((p, i) => distance(pts[i], p));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total <= 0) return null;
  let rest = total * fraction;
  for (let i = 0; i < lengths.length; i += 1) {
    if (rest <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(1, rest / lengths[i]);
      const a = pts[i];
      const b = pts[i + 1];
      // The short way round: a leg over the dateline runs 179 -> -179, not back across the map.
      let dLon = b[0] - a[0];
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      const lon = ((((a[0] + dLon * t + 180) % 360) + 360) % 360) - 180;
      // A sample a little further on — or, at the very end of a segment, one
      // behind mirrored forward — so `ahead` never lands on `position` (which
      // would turn the globe's arrow to a fixed east).
      const step = t > 0.96 ? -0.04 : 0.04;
      const t2 = t + step;
      const lon2 = ((((a[0] + dLon * t2 + 180) % 360) + 360) % 360) - 180;
      return {
        ahead:
          step > 0
            ? [lon2, a[1] + (b[1] - a[1]) * t2]
            : [lon + (lon - lon2), a[1] + (b[1] - a[1]) * t + (b[1] - a[1]) * (t - t2)],
        position: [lon, a[1] + (b[1] - a[1]) * t],
        bearing: bearingBetween(a, b),
        color: line.color,
        dim: line.dim === true,
      };
    }
    rest -= lengths[i];
  }
  return null;
}

// A white chevron pointing up, tinted per line through `mask`.
const CHEVRON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 6 L56 54 L32 42 L8 54 Z" fill="white"/></svg>'
)}`;

const ARROW_SIZE_PX = 16;

/** One arrow per line (a round trip's two kept apart); the flat layer and the globe overlay read the same list. */
export function arrowData(lines: readonly DirectionLine[]): ArrowDatum[] {
  // A round trip is two lines over one path: both arrows at the middle would
  // overlap into a star. The later ones step back toward their own start — and
  // since they run the other way, that is a different place on the path.
  const taken = new Map<string, number>();
  const data = lines
    .map((line) => {
      const mid = arrowFor(line);
      if (!mid) return null;
      const key = `${mid.position[0].toFixed(1)},${mid.position[1].toFixed(1)}`;
      const seen = taken.get(key) ?? 0;
      taken.set(key, seen + 1);
      return seen === 0 ? mid : arrowFor(line, Math.max(0.1, 0.5 - 0.1 * seen));
    })
    .filter((a): a is ArrowDatum => a !== null);
  return data;
}

export function buildArrowLayer(lines: readonly DirectionLine[]): Layer | null {
  const data = arrowData(lines);
  if (data.length === 0) return null;
  return new IconLayer<ArrowDatum>({
    id: "trip-direction-arrows",
    data,
    getPosition: (d) => d.position,
    // deck.gl turns counter-clockwise; a bearing runs clockwise.
    getAngle: (d) => -d.bearing,
    getIcon: () => ({ url: CHEVRON, width: 64, height: 64, mask: true }),
    getColor: (d) => [...d.color, d.dim ? 90 : 255] as [number, number, number, number],
    getSize: ARROW_SIZE_PX,
    sizeUnits: "pixels",
    pickable: false,
  });
}

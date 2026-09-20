import { TripsLayer } from "deck.gl";
import { IconLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../types";
import type { TripDatum } from "./layerTypes";
import { greatCirclePath } from "./greatCircle";
import { screenTangentDeg } from "./screenTangent";
import { tokens } from "../../theme/tokens";
import { hexToRgb } from "../../lib/domainColor";

/**
 * Turn flights into the animated journey the time slider scrubs.
 *
 * The path is the GREAT CIRCLE, densified by the same `greatCirclePath` the
 * flat route shape uses. It was `[coords[0], coords[last]]` — two points — so
 * the trail travelled the straight lon/lat chord between the airports while
 * the map drew the route as an arc: "die Flieger-Animation folgt nicht der
 * Route" (owner, 2026-09-20). On LPA→YVR the two lines are thousands of
 * kilometres apart at the midpoint.
 *
 * Timestamps are spread evenly over the vertices, which are themselves evenly
 * spaced along the arc — i.e. a constant ground speed. That is the only speed
 * profile the payload supports; a departure and an arrival time say nothing
 * about the climb, and inventing one would be a claim about data we do not
 * have.
 */
export function buildTripsData(flights: GeoJSONFeature[]): TripDatum[] {
  return (
    flights
      .filter((f) => {
        const coords = f.geometry.coordinates;
        return coords != null && coords.length >= 2;
      })
      .map((f) => {
        const coords = f.geometry.coordinates;
        const t0 = f.properties.departureTime
          ? new Date(f.properties.departureTime).getTime() / 1000
          : 0;
        const t1 = f.properties.arrivalTime
          ? new Date(f.properties.arrivalTime).getTime() / 1000
          : 0;
        const { points } = greatCirclePath(
          coords[0] as [number, number],
          coords[coords.length - 1] as [number, number]
        );
        const last = points.length - 1;
        return {
          path: points,
          // TripsLayer pairs path and timestamps BY INDEX, so the two arrays
          // must stay the same length. The endpoints are written verbatim
          // rather than interpolated, so a flight's animation starts and ends
          // exactly on the times the flight carries.
          timestamps: points.map((_, i) => (i === last ? t1 : t0 + ((t1 - t0) * i) / last)),
        };
      })
      // Filter out trips with invalid timestamps so NaN never reaches the TimeSlider (Bug 6)
      .filter((t) => t.timestamps.every((ts) => !isNaN(ts)))
  );
}

/**
 * The slider's bounds.
 *
 * A loop, not `Math.min(...all)`. The spread passes every timestamp as an
 * ARGUMENT, and this engine throws RangeError at about 124 920 of them.
 * That was comfortable while a flight contributed two timestamps; densifying
 * the path onto the great circle made it 11 to 121, a 5–60× rise, so an
 * account that used to sit at sixty thousand values now clears the limit —
 * and the failure is not a slow slider, it is trips mode throwing.
 */
export function getTimeRange(trips: TripDatum[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const trip of trips) {
    for (const ts of trip.timestamps) {
      if (isNaN(ts)) continue;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
  }
  // Abstain rather than hand the slider ±Infinity: an empty set has no range,
  // and the callers already read {0, 0} as "nothing to scrub".
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

export function createTripsLayer(trips: TripDatum[], currentTime: number): TripsLayer<TripDatum> {
  return new TripsLayer<TripDatum>({
    id: "trips",
    data: trips,
    getPath: (d) => d.path,
    getTimestamps: (d) => d.timestamps,
    getColor: [255, 255, 255, 200],
    currentTime,
    trailLength: 3600 * 6,
    widthMinPixels: 1.5,
  });
}

/** Where the aircraft is right now, and which way it is facing. */
export interface PlaneDatum {
  position: [number, number];
  /** deck.gl icon rotation: y-up, 0 = pointing east, positive counterclockwise
   *  — the same convention `cruiseArcsLayer`'s direction arrows use, which was
   *  verified in a browser against `icon-layer-vertex.glsl.js` (#160). The
   *  angle is measured in the PROJECTION, not in lon/lat: see
   *  `screenTangent.ts`. */
  angleDeg: number;
}

/**
 * Sample one trip at `currentTime`.
 *
 * Reads the SAME vertex array the trail is drawn from, so the icon cannot
 * drift off its own route however the path was built. The heading is the
 * bearing of the segment the plane is currently on — a curved route's plane
 * points along the curve, not at its destination.
 *
 * Returns null outside the flight's own window, and for a flight with no
 * usable times: a plane parked on the map at an hour it was not flying is
 * worse than no plane. (`buildTripsData` writes 0 for a missing time, so an
 * undated flight arrives here with a zero-length window.)
 */
export function planeAt(trip: TripDatum, currentTime: number): PlaneDatum | null {
  const { path, timestamps } = trip;
  if (path.length < 2 || timestamps.length !== path.length) return null;
  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];
  if (!(end > start)) return null;
  if (currentTime < start || currentTime > end) return null;

  let i = 0;
  while (i < path.length - 2 && timestamps[i + 1] <= currentTime) i++;
  const span = timestamps[i + 1] - timestamps[i];
  const f = span > 0 ? (currentTime - timestamps[i]) / span : 0;
  const [x0, y0] = path[i];
  const [x1, y1] = path[i + 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  return {
    // The POSITION interpolates linearly in lon/lat — the vertices are ~2° of
    // arc apart, so the difference from interpolating in projected space is
    // far below a pixel. The HEADING cannot be taken the same way: deck.gl
    // rotates the icon in screen space, which is Mercator, and on LPA→YVR the
    // lon/lat angle is up to 8.4° off the line the plane is sitting on. See
    // `screenTangent.ts`.
    position: [x0 + dx * f, y0 + dy * f],
    angleDeg: dx === 0 && dy === 0 ? 0 : screenTangentDeg(path[i], path[i + 1]),
  };
}

export function buildPlaneData(trips: TripDatum[], currentTime: number): PlaneDatum[] {
  const out: PlaneDatum[] = [];
  for (const trip of trips) {
    const plane = planeAt(trip, currentTime);
    if (plane) out.push(plane);
  }
  return out;
}

// Nose at the right edge so angle 0 means east, matching the arrow icon in
// `cruiseArcsLayer.ts` and the `atan2(dLat, dLon)` above. Rasterised well
// above its drawn size for the same reason that file gives: the browser
// rasterises the data-URL at the SVG's declared size, and deck.gl packs THAT
// bitmap, so a small declared size upsamples on a HiDPI display.
const PLANE_ICON_UNITS = 24;
const PLANE_RASTER_SCALE = 6;
const PLANE_DISPLAY_PX = 20;

function rgbaCss(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function planeIcon(): { id: string; url: string; width: number; height: number } {
  const size = PLANE_ICON_UNITS * PLANE_RASTER_SCALE;
  const fill = rgbaCss(tokens.domainColor.flight, 1);
  const stroke = rgbaCss(tokens.color.bg, 0.85);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${PLANE_ICON_UNITS} ${PLANE_ICON_UNITS}">` +
    `<path d="M22 12 L14 14.4 L10.4 21 L8 21 L9.6 14.4 L5 15.2 L3.4 17.6 L1.8 17.6 ` +
    `L2.8 12 L1.8 6.4 L3.4 6.4 L5 8.8 L9.6 9.6 L8 3 L10.4 3 L14 9.6 Z" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="0.9" stroke-linejoin="round"/>` +
    `</svg>`;
  return {
    id: "trips-plane",
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: size,
    height: size,
  };
}

/**
 * The aircraft at the head of each visible trail.
 *
 * Deliberately FLAT — no altitude on the icon and none on the path. Trips mode
 * replaces the route layers entirely (`DeckGLMap.tsx`, `case "trips"`), so
 * there is no raised arc on screen for the plane to agree with; and on a
 * top-down map a raised icon is simply an icon drawn beside its own ground
 * track, which is the bug this step exists to fix rather than a second
 * rendering of it. The "Bogen/Flach" setting belongs to the route shape and
 * has no meaning here.
 *
 * Returns null when nothing is in the air, so the caller mounts no layer at
 * all rather than an empty one.
 */
export function createPlaneLayer(trips: TripDatum[], currentTime: number): Layer | null {
  const data = buildPlaneData(trips, currentTime);
  if (data.length === 0) return null;
  const icon = planeIcon();
  return new IconLayer<PlaneDatum>({
    id: "trips-planes",
    data,
    getPosition: (d) => d.position,
    getIcon: () => icon,
    getAngle: (d) => d.angleDeg,
    getSize: PLANE_DISPLAY_PX,
    sizeUnits: "pixels",
    pickable: false,
  });
}

/**
 * Everything trips mode draws: the trail, and the aircraft riding its head.
 *
 * Assembled here rather than in `DeckGLMap`'s switch so the two layers cannot
 * be mounted apart — a trail with no plane is what the owner was looking at on
 * 2026-09-20, and a plane built from a different path than the trail is the
 * bug one level subtler.
 */
export function createTripsModeLayers(trips: TripDatum[], currentTime: number): Layer[] {
  const trail = createTripsLayer(trips, currentTime);
  const planes = createPlaneLayer(trips, currentTime);
  return planes ? [trail, planes] : [trail];
}

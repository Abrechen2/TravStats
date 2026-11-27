import type { LonLat } from "../Cruise/routeEditorState";

/**
 * Handles a stored line starts with in the single-ride editors (bus, ferry).
 * The shared budget (25, `EDITOR_HANDLE_BUDGET`) suits a cruise leg hundreds of
 * km long; a coach ride or a short crossing is often a few km, and 25 handles at
 * that size covered the line completely — the editor showed only circles and
 * "click the line" could not be followed (rc46 UAT, #409).
 */
export const RIDE_EDITOR_HANDLES = 10;

/** A tenth of the line's extent on each side, at least this much (≈ 200 m). */
const MIN_PAD_DEG = 0.002;
const PAD_SHARE = 0.1;

/**
 * The camera frame of the line being edited: the line's own extent plus a
 * margin relative to it. The detail maps pad a fixed 0.3° (≈ 30 km), which
 * shrank a short ride to a dot under its handles.
 */
export function rideEditorBounds(line: readonly LonLat[]): [[number, number], [number, number]] {
  const lons = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const padLon = Math.max((e - w) * PAD_SHARE, MIN_PAD_DEG);
  const padLat = Math.max((n - s) * PAD_SHARE, MIN_PAD_DEG);
  return [
    [w - padLon, s - padLat],
    [e + padLon, n + padLat],
  ];
}

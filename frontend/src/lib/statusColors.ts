import type { Rgb } from "./cruiseColor";

/**
 * Shared flight-status tint helpers for the "Alle" two-tone scheme.
 * Both the flat map (`components/layers/routesLayer.ts`) and the globe
 * (`components/Globe/buildGlobeLayers.ts`) import from here so the two
 * renderers can never drift on what "past" vs. "scheduled" looks like.
 *
 * Each status hue is now a low→high pair rather than a single flat
 * color: the hue signals status (orange = past, blue = upcoming), and
 * `frequencyIntensity` + `flightStatusTint` modulate how saturated that
 * hue is by route frequency, so rare routes read soft and frequent
 * routes read vivid — restoring the frequency signal the old flat
 * two-tone scheme lost.
 */

/** Amber (#f0a947) — rare (low-frequency) past route. Historical, mixed
 *  and regular past-only routes all resolve into this hue family when
 *  `statusTwoTone` is active. */
export const FLIGHT_PAST_LOW: Rgb = [240, 169, 71];
/** Vivid orange-500 — frequent (high-frequency) past route. */
export const FLIGHT_PAST_HIGH: Rgb = [249, 115, 22];

/** Soft blue — rare (low-frequency) pure-scheduled (never-flown) route. */
export const FLIGHT_SCHEDULED_LOW: Rgb = [130, 195, 235];
/** Sky-blue — frequent (high-frequency) pure-scheduled route. */
export const FLIGHT_SCHEDULED_HIGH: Rgb = [80, 200, 255];

/**
 * Component-wise linear interpolation between two RGB triples. `t` is
 * clamped to [0, 1] before interpolating, so callers can pass an
 * unclamped ratio without producing out-of-gamut values. Returns a
 * fresh tuple — never mutates either input.
 */
export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped),
  ];
}

/**
 * Maps a route's flight count to a 0..1 intensity ratio against the
 * dataset's frequency quartiles, with a visible floor so rare routes
 * still read clearly instead of fading toward invisibility: the ratio
 * is capped to [0.2, 1] rather than [0, 1].
 *
 * - At/above `q75` (frequent): fully saturated → 1.
 * - At/below `q25` (rare): the floor → 0.2.
 * - In between: linear ramp from the floor up to 1.
 *
 * `q50` is accepted for signature symmetry with the dataset's full
 * quartile triple (every call site already computes it for the
 * heatmap) but isn't used by the current linear ramp.
 */
export function frequencyIntensity(count: number, q25: number, _q50: number, q75: number): number {
  if (count >= q75) return 1;
  if (count <= q25) return 0.2;
  const ratio = 0.2 + (0.8 * (count - q25)) / Math.max(1, q75 - q25);
  return Math.min(1, Math.max(0.2, ratio));
}

/**
 * Resolves the frequency-modulated status tint for the "Alle" two-tone
 * scheme: `isScheduled` picks the hue family (blue for pure-scheduled,
 * orange for everything else — historical, mixed, regular past-only),
 * `t` (from `frequencyIntensity`) picks how saturated that hue is.
 */
export function flightStatusTint(isScheduled: boolean, t: number): Rgb {
  return isScheduled
    ? lerpRgb(FLIGHT_SCHEDULED_LOW, FLIGHT_SCHEDULED_HIGH, t)
    : lerpRgb(FLIGHT_PAST_LOW, FLIGHT_PAST_HIGH, t);
}

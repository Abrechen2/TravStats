/**
 * The one time gap that cuts a recorded track in two (TravTrack, owner
 * 2026-11-09: "Track bleibt so wie es Dawarich macht"). Dawarich splits a
 * point stream into tracks only where the time between two points exceeds a
 * threshold the user sets, and ignores distance; so does this. Two hours was
 * the fixed value before it became a setting, and stays the default: a phone
 * at rest sends few fixes, and a shorter default would cut a walk with a café
 * stop into several entries.
 */
export const DEFAULT_TRACK_GAP_MINUTES = 120;
export const MIN_TRACK_GAP_MINUTES = 5;
export const MAX_TRACK_GAP_MINUTES = 720;

const MS_PER_MINUTE = 60_000;
export const DEFAULT_TRACK_GAP_MS = DEFAULT_TRACK_GAP_MINUTES * MS_PER_MINUTE;

/** A stored or requested value, brought inside the bounds; a non-number is the default. */
export function clampTrackGapMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TRACK_GAP_MINUTES;
  return Math.min(MAX_TRACK_GAP_MINUTES, Math.max(MIN_TRACK_GAP_MINUTES, Math.round(value)));
}

export const trackGapMsOf = (minutes: unknown): number =>
  clampTrackGapMinutes(minutes) * MS_PER_MINUTE;

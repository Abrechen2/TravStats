import type { TrackPoint } from "../../../lib/api/travtrack";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackPhotoFailureKind, type PhotoWindow } from "../../../lib/api/travtrackViews";

/**
 * Photos on the Track map and in the flight panel (TravTrack plan T5.3). The
 * server places each photo on the own privacy-safe track by its time and
 * leaves out every photo it cannot place (a zone, a cut, no recording) — so a
 * photo appears exactly where the server returns it, never anywhere else.
 * One request covers at most seven days.
 */

export const PHOTO_WINDOW_MAX_MS = 7 * 86_400_000;

/** The Immich failure kinds the server answers with (CLAUDE.md, Immich albums). */
const IMMICH_KINDS = new Set([
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
]);

/** The copy key of a refused photo request: the Immich kind as itself, else the generic reasons. */
export function photoFailureKey(err: unknown): string {
  const kind = travTrackPhotoFailureKind(err);
  return kind && IMMICH_KINDS.has(kind) ? `track:photos.failure.${kind}` : trackErrorKey(err);
}

/** Whether the failure is a missing Immich connection — the copy then points to Settings. */
export const isNotConfigured = (key: string): boolean =>
  key === "track:photos.failure.notConfigured";

export type WindowOf =
  { kind: "none" } | { kind: "tooLong" } | { kind: "window"; window: PhotoWindow };

/**
 * The photo window of what is shown: from its first to just after its last
 * recorded instant. Nothing recorded asks for nothing; more than seven days
 * is refused here already, as the server would.
 */
export function photoWindowOf(segments: readonly TrackPoint[][]): WindowOf {
  let first = Infinity;
  let last = -Infinity;
  for (const s of segments) {
    for (const p of s) {
      if (p[0] < first) first = p[0];
      if (p[0] > last) last = p[0];
    }
  }
  if (first === Infinity) return { kind: "none" };
  if (last + 1 - first > PHOTO_WINDOW_MAX_MS) return { kind: "tooLong" };
  return {
    kind: "window",
    window: { from: new Date(first).toISOString(), to: new Date(last + 1).toISOString() },
  };
}

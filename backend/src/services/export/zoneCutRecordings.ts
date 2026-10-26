import { privacyCircleSet } from "../travtrack/privacyCircles";
import { cutFlightTrackWith, type FlightTrackLine } from "../travtrack/flightTrackView";
import { privacySafeStretches } from "../tripRecording/privacySafe";
import type { StoredPoint } from "../tripRecording/segments";

/**
 * The legacy recordings — a flight's `flight_tracks` line and a trip's
 * `trip_recording_batches`, uploaded through the entry routes before
 * TravTrack — as the owner's privacy zones let them LEAVE in an account
 * export (owner decision 2026-10-26, final Codex review P1). The stored rows
 * are untouched; only what is written out is cut, with the same circles the
 * web reads them through (`privacyCircleSet`: every zone in force, and every
 * former zone still covering a line begun before it went). TravTrack's own
 * points never sit inside a zone, so this is only the old route. The admin
 * instance backup keeps everything: it is the restore copy.
 */

type BatchLike = { startedAt: Date; points: unknown; pointCount: number };
type UserLike = {
  flights: Array<{ track: (FlightTrackLine & object) | null }>;
  tripRecordingBatches: BatchLike[];
};

const asPoints = (raw: unknown): StoredPoint[] =>
  Array.isArray(raw) ? (raw.filter((p) => Array.isArray(p) && p.length >= 3) as StoredPoint[]) : [];

export async function withZoneCutRecordings<T extends UserLike>(
  userId: string,
  user: T
): Promise<T> {
  const circlesFor = await privacyCircleSet(userId);
  const flights = user.flights.map((f) => {
    if (!f.track) return f;
    const circles = circlesFor(f.track.startedAt.getTime());
    return circles.length === 0 ? f : { ...f, track: cutFlightTrackWith(f.track, circles).track };
  });
  const tripRecordingBatches = user.tripRecordingBatches.flatMap((b) => {
    const circles = circlesFor(b.startedAt.getTime());
    if (circles.length === 0) return [b];
    const kept = privacySafeStretches([asPoints(b.points)], circles).flat();
    // A batch wholly inside a zone leaves nothing — not an empty upload beside its count.
    return kept.length === 0 ? [] : [{ ...b, points: kept, pointCount: kept.length }];
  });
  return { ...user, flights, tripRecordingBatches };
}

/**
 * Client-side "does a recorded track cover this leg" check (phase 3b, task
 * 8). Gates the `track` option in `TourLegList` the same way
 * `routingAvailable` gates `routed`: a control whose only possible outcome
 * is a 409 must not be offered at all — see `TourLegList.tsx`'s own doc
 * comment on that rule, established by fix round 1 of an earlier task and
 * extended here to a second source.
 *
 * This mirrors the ANCHOR check inside `adoptSegment`
 * (`backend/src/services/tour/tracks/adoptTrack.ts`) closely enough to
 * agree with the server's real 409 boundary, but is NOT a port of that
 * function: this only answers "yes, and which track", never cuts or
 * reverses a segment — the actual adoption still happens server-side, from
 * the track id this module picks. The frontend cannot import backend code,
 * so the tolerance constant is duplicated rather than shared — the same
 * convention `LEG_SOURCES`/`LEG_MODES` in `types/tour.ts` already follow
 * for their own backend mirrors.
 */

export interface CoordLike {
  lat: number;
  lon: number;
}

/** Mirrors `ANCHOR_TOLERANCE_KM` in `backend/src/services/tour/tracks/adoptTrack.ts`. */
export const TRACK_ANCHOR_TOLERANCE_KM = 1;

function haversineKm(a: CoordLike, b: CoordLike): number {
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

/** The closest distance from `target` to any point in `track`, in km. */
function nearestKm(track: ReadonlyArray<[number, number]>, target: CoordLike): number {
  let best = Infinity;
  for (const [lon, lat] of track) {
    const km = haversineKm({ lat, lon }, target);
    if (km < best) best = km;
  }
  return best;
}

/**
 * True iff `track`'s recorded points come within `maxAnchorKm` of BOTH
 * `from` and `to` — a track with fewer than two points can never cover a
 * leg (nothing to cut a segment out of), so that case is `false` up front
 * rather than relying on `Infinity` comparisons to fall out the same way.
 */
export function trackCoversLeg(
  track: ReadonlyArray<[number, number]>,
  from: CoordLike,
  to: CoordLike,
  maxAnchorKm: number = TRACK_ANCHOR_TOLERANCE_KM
): boolean {
  if (track.length < 2) return false;
  return nearestKm(track, from) <= maxAnchorKm && nearestKm(track, to) <= maxAnchorKm;
}

export interface TrackWithGeometry {
  id: string;
  geometry: ReadonlyArray<[number, number]>;
}

/**
 * The first track among `tracks` that covers this leg, or `undefined` when
 * none does. `tracks` is expected pre-sorted oldest-started-first — the
 * order `toursApi.tracks.list` already returns — so "first match" is a
 * deterministic, meaningful choice (the earliest recording that passes
 * both stops) rather than an arbitrary one.
 */
export function findCoveringTrackId(
  tracks: ReadonlyArray<TrackWithGeometry>,
  from: CoordLike,
  to: CoordLike
): string | undefined {
  return tracks.find((track) => trackCoversLeg(track.geometry, from, to))?.id;
}

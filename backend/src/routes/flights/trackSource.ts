import { z } from "zod";

import {
  flightEntryTrack,
  TRACK_ORIGINS,
  type EntryTrackDevice,
  type TrackOrigin,
} from "../../services/locationProvider/entryTrack";
import type { FlightWindowColumns } from "../../services/flightDevice/flightWindow";
import { flightTrackColumns } from "../../services/flightDevice/flightTrackIngest";
import { cutGeometry } from "../../services/travtrack/cutGeometry";
import { privacyCirclesFor } from "../../services/travtrack/privacyCircles";
import type { LonLat } from "../../services/travtrack/privacyCut";

/**
 * Where `GET /flights/:id/track` takes its line from (TravTrack plan T5): the
 * stored recording, or — without one, or on `?source=` — TravTrack's or
 * Dawarich's points for the flight, run through the SAME pipeline a phone's
 * upload goes through (jitter out, holes marked, measured, simplified). The
 * answer keeps the `track` shape and says where it came from.
 *
 * A flight is one aircraft's path, so of several phones the one with the most
 * fixes draws it. Every line, whatever its origin, leaves through `privacyCut`.
 */

export const trackSourceQuerySchema = z.object({
  source: z.enum(TRACK_ORIGINS).optional().describe("Show this source explicitly"),
});

type StoredTrackShape = {
  geometry: unknown;
  segmentStarts: unknown;
};

const lonLatLine = (value: unknown): LonLat[] =>
  Array.isArray(value)
    ? value.filter(
        (p): p is LonLat => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      )
    : [];
const indexList = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : [0];

/** A stored track's line, privacy-cut. */
export async function cutStoredTrack<T extends StoredTrackShape>(
  userId: string,
  track: T,
  fromMs: number
): Promise<T> {
  const circles = await privacyCirclesFor(userId, fromMs);
  if (circles.length === 0) return track;
  const cut = cutGeometry(lonLatLine(track.geometry), indexList(track.segmentStarts), circles);
  return { ...track, ...cut };
}

/** The track shape from provider points, or null when they make no line. */
function trackOf(
  flightId: string,
  origin: Exclude<TrackOrigin, "travstats">,
  devices: readonly EntryTrackDevice[]
) {
  const device = [...devices].sort((a, b) => b.points.length - a.points.length)[0];
  if (!device || device.points.length < 2) return null;
  const columns = flightTrackColumns(
    device.points.map((p) => ({
      t: p.atMs,
      lat: p.lat,
      lon: p.lon,
      ...(p.altitudeM !== null ? { alt: p.altitudeM } : {}),
      ...(p.accuracyM !== null ? { accuracy: p.accuracyM } : {}),
    }))
  );
  if (!columns) return null;
  return {
    id: flightId,
    flightId,
    source: origin,
    uploadId: "",
    deviceId: device.deviceId,
    startedAt: columns.startedAt,
    endedAt: columns.endedAt,
    pointCount: columns.pointCount,
    jitterDropped: columns.jitterDropped,
    distanceKm: columns.distanceKm,
    geometry: columns.geometry as unknown,
    segmentStarts: columns.segmentStarts as unknown,
    elevations: columns.elevations as unknown,
    createdAt: columns.endedAt,
    updatedAt: columns.endedAt,
  };
}

export type ProviderFlightTrack = NonNullable<ReturnType<typeof trackOf>>;

export async function providerFlightTrack(
  userId: string,
  flight: FlightWindowColumns & { id: string },
  source: TrackOrigin | undefined
) {
  const entry = await flightEntryTrack(userId, flight, { source });
  const built =
    entry.origin === "travtrack" || entry.origin === "dawarich"
      ? trackOf(flight.id, entry.origin, entry.devices)
      : null;
  const track = built ? await cutStoredTrack(userId, built, built.startedAt.getTime()) : null;
  return { entry, track };
}

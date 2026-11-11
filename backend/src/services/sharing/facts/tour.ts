import type { Prisma, TripRoute, TripRouteTrack } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * A tour's facts (tours-own-domain T1b, Decision 4): what it is called, how it was travelled and
 * the day it happened. Private, as for a roadtrip: notes, tags, the map colour, odometer readings,
 * expenses. Not carried: `anchorStopId` (a station of the sender's own roadtrip) and the vehicle
 * columns (a roadtrip's). A tour's stations and legs reuse the roadtrip lists
 * (`ROADTRIP_STATION_FACT_FIELDS`, `ROADTRIP_LEG_FACT_FIELDS`): one engine, one shape.
 */
export const TOUR_FACT_FIELDS = [
  "name",
  "mode",
  "orderIdx",
  "activity",
  "tourDate",
  "tourStartMinute",
] as const satisfies readonly (keyof TripRoute)[];
export type TourFactField = (typeof TOUR_FACT_FIELDS)[number];

export function tourFacts(row: Pick<TripRoute, TourFactField>) {
  return pickFacts(row, TOUR_FACT_FIELDS) satisfies Partial<Prisma.TripRouteUncheckedCreateInput>;
}

/**
 * A recorded track: the line, its measured figures and when it was recorded. NOT carried: the
 * source record's own id (`externalRef`: a Strava activity id, a HealthKit workout UUID), the
 * row id and the creation time. `key` is the track's identity across accounts — it has no share
 * key column, so it is derived from what the recording is (source and span), which is stable
 * through a copy.
 */
export const TOUR_TRACK_FACT_FIELDS = [
  "source",
  "name",
  "startedAt",
  "endedAt",
  "geometry",
  "segmentStarts",
  "cumulativeKm",
  "pointCount",
  "jitterDropped",
  "distanceKm",
  "truncated",
  "elevations",
  "ascentM",
  "descentM",
  "movingSeconds",
] as const satisfies readonly (keyof TripRouteTrack)[];
export type TourTrackFactField = (typeof TOUR_TRACK_FACT_FIELDS)[number];

/** The track columns that hold JSON (written as SQL NULL, not JSON null, when absent). */
export const TOUR_TRACK_JSON_FIELDS = [
  "geometry",
  "segmentStarts",
  "cumulativeKm",
  "elevations",
] as const;

export function tourTrackFacts(row: Pick<TripRouteTrack, TourTrackFactField>) {
  return pickFacts(row, TOUR_TRACK_FACT_FIELDS);
}

/**
 * The identity of a track: its source and span. Two rows of one tour with the same identity are one
 * recording imported twice; the adapter carries the first only (`tourRows`), so the key is a
 * function of the data and never of row order.
 */
export const trackKey = (t: Pick<TripRouteTrack, "source" | "startedAt" | "endedAt">): string =>
  `${t.source}|${t.startedAt.getTime()}|${t.endedAt.getTime()}`;

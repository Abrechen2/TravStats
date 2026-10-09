import { classifyTour, type TourState } from "../../shared/tour/tourCounting";
import { localDay } from "../../shared/time/instant";
import { isValidZone } from "../../shared/time/zonedParts";

/**
 * What one day tour measured (forgejo#264, and the tours along a roadtrip in
 * #260). Pure. The loader is `services/stats/insights/tourInsightData.ts`.
 *
 * Two sources of distance are kept apart because they mean different things:
 * a RECORDED track is what was walked or ridden; the route's legs are what was
 * planned or drawn. A tour with a recording reports the recording; one
 * without reports its route and says so. Climb, moving time and height come
 * only from recordings — a drawn line has none of them, and a figure that
 * pretended otherwise would be invented.
 */
export interface InsightTrack {
  startedAt: Date;
  endedAt: Date;
  distanceKm: number;
  ascentM: number | null;
  movingSeconds: number | null;
  /** Highest point of the profile, or null when the source had no elevation. */
  maxElevationM: number | null;
  truncated: boolean;
}

export interface InsightTour {
  id: string;
  name: string;
  activity: string | null;
  tourDate: Date | null;
  zone: string | null;
  tripId: string | null;
  tripName: string | null;
  /** The roadtrip station it set out from, and that station's roadtrip. */
  anchorStopId: string | null;
  anchorRoadtripId: string | null;
  /** The trip holds a cruise whose days include the tour's day. */
  duringCruise: boolean;
  /** ISO country of its first point, from the boundary set — never guessed from a name. */
  country: string | null;
  /**
   * Where it set out: the first station that has a position. The cruise
   * insights link a shore excursion to a port call by it (forgejo#257); the
   * badge check reads it from this one tour load instead of loading the tours
   * again. A tour positioned only by its recording has `null` here — the
   * caller asks the recording's first point (`firstTrackPoints`) for those.
   */
  start: { lat: number; lon: number } | null;
  routeKm: number;
  tracks: InsightTrack[];
}

export interface TourFacts {
  tour: InsightTour;
  state: TourState;
  /** Year of the tour's day, else of its first recording; null when neither. */
  year: number | null;
  /** `YYYY-MM-DD` of that day, or null. */
  day: string | null;
  km: number | null;
  kmSource: "track" | "route" | null;
  /** Sum over recordings, or null unless EVERY recording carries it. */
  ascentM: number | null;
  movingSeconds: number | null;
  /** Elapsed recording time minus moving time, or null unless both are known. */
  pauseSeconds: number | null;
  maxElevationM: number | null;
  /** A recording that stopped at the import limit — its distance is a lower bound. */
  partial: boolean;
}

/** A figure summed over recordings, or null unless every recording has it. */
function overEvery(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((sum, v) => sum + v, 0);
}

export function tourFacts(tour: InsightTour, now: Date): TourFacts {
  const state = classifyTour(tour, now);
  const firstTrack = [...tour.tracks].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
  )[0];
  // `tourDate` is already the local day at the tour's place. A recording's
  // start is an instant, so its day is read on the tour's own clock — a hike
  // begun on New Year's Eve in California is a December hike, not a January
  // one in UTC.
  const day = tour.tourDate
    ? tour.tourDate.toISOString().slice(0, 10)
    : firstTrack
      ? localDay(firstTrack.startedAt, tour.zone && isValidZone(tour.zone) ? tour.zone : "UTC")
      : null;
  const recorded = tour.tracks.length > 0;
  const trackKm = tour.tracks.reduce((sum, t) => sum + t.distanceKm, 0);
  const moving = overEvery(tour.tracks.map((t) => t.movingSeconds));
  const elapsed = tour.tracks.reduce(
    (sum, t) => sum + Math.max(0, (t.endedAt.getTime() - t.startedAt.getTime()) / 1000),
    0
  );
  const heights = tour.tracks.flatMap((t) => (t.maxElevationM === null ? [] : [t.maxElevationM]));
  return {
    tour,
    state,
    year: day ? Number(day.slice(0, 4)) : null,
    day,
    km: recorded ? trackKm : tour.routeKm > 0 ? tour.routeKm : null,
    kmSource: recorded ? "track" : tour.routeKm > 0 ? "route" : null,
    ascentM: overEvery(tour.tracks.map((t) => t.ascentM)),
    movingSeconds: moving,
    pauseSeconds: moving === null ? null : Math.max(0, Math.round(elapsed - moving)),
    maxElevationM: heights.length > 0 ? Math.max(...heights) : null,
    partial: tour.tracks.some((t) => t.truncated),
  };
}

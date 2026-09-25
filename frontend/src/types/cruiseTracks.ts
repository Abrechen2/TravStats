import type { CruiseGeometrySource } from "../lib/api/cruise";
import type { TrackVerdict } from "./trackCoverage";

/** A recording of a cruise, without its line (`GET /cruises/:id/tracks`). */
export interface CruiseTrackMeta {
  id: string;
  cruiseId: string;
  source: string;
  name: string | null;
  startedAt: string;
  endedAt: string;
  pointCount: number;
  distanceKm: number;
  truncated: boolean;
  externalRef: string | null;
  createdAt: string;
  /** Ordinals of the legs whose line and kilometres this recording supplies. */
  coveredLegs: number[];
}

export interface CruiseTimeWindow {
  startAt: string;
  endAt: string;
}

/** One leg of the cruise and what the recordings say about it. */
export interface CruiseLegTrack {
  ordinal: number;
  fromPortId: number;
  toPortId: number;
  fromPortName: string;
  toPortName: string;
  /** As counted in the statistics; null before the legs were computed. */
  distanceKm: number | null;
  geometrySource: CruiseGeometrySource;
  /** Null when the cruise has no recordings. */
  coverage: TrackVerdict | null;
  window: CruiseTimeWindow | null;
}

export interface CruiseTrackOverview {
  tracks: CruiseTrackMeta[];
  legs: CruiseLegTrack[];
  window: CruiseTimeWindow | null;
}

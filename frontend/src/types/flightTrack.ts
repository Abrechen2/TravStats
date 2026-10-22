import type { TimeValue } from "../shared/time";

/** `companion` from the phone (forgejo#193); the file format for an upload (forgejo#312). */
export type FlightTrackSource = "companion" | "gpx" | "kml" | "tcx" | "fit" | "csv";

/**
 * A recording of a flight, as `GET /flights/:id/track` serves it — the
 * phone's (forgejo#193) or an uploaded file (forgejo#312). Kept apart from
 * `Flight.actualRoute`, which is the provider's line and is overwritten by
 * every lookup.
 */
export interface FlightTrack {
  id: string;
  flightId: string;
  source: FlightTrackSource;
  uploadId: string;
  deviceId: string | null;
  times: { startedAt: TimeValue; endedAt: TimeValue };
  /** Points of the raw recording, before simplification. */
  pointCount: number;
  /**
   * Fixes left out as GPS jitter before the line was drawn and measured
   * (forgejo#319); null when not checked — stored before the filter, or a
   * recording without times.
   */
  jitterDropped: number | null;
  /** Measured on the raw points; stretches without a fix excluded. */
  distanceKm: number;
  /** `[lon, lat]`, simplified. */
  geometry: Array<[number, number]>;
  /** Index into `geometry` where each recorded stretch starts; between them, no fix. */
  segmentStarts: number[];
  /** `[km, metres]`; null when no point carried an altitude. */
  elevations: Array<[number, number]> | null;
  createdAt: string;
  updatedAt: string;
}

/** What a write answers: the recording without its line. */
export type FlightTrackMeta = Omit<FlightTrack, "geometry" | "segmentStarts" | "elevations">;

/** One recorded line for the map, as `GET /flights/track-lines` serves it. */
export interface FlightTrackLine {
  flightId: string;
  /** `[lon, lat]`, simplified. */
  geometry: Array<[number, number]>;
  /** Index into `geometry` where each recorded stretch starts. */
  segmentStarts: number[];
}

/** A recording as it is drawn: what the receiver measured, and the holes between. */
export interface FlightTrackPieces {
  /** Stretches of two or more consecutive fixes — drawn solid. */
  solid: Array<Array<[number, number]>>;
  /**
   * The connectors across each hole: the last fix of one stretch to the first
   * of the next. Consecutive holes around one-fix stretches run on as one
   * line, so that fix stays on the drawing. Drawn dashed and fainter: the line
   * reads as one flight, yet nothing claims a fix the phone never had.
   */
  gaps: Array<Array<[number, number]>>;
}

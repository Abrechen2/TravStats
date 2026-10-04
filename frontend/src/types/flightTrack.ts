import type { TimeValue } from "../shared/time";

/**
 * The phone's recording of a flight, as `GET /flights/:id/track` serves it
 * (forgejo#193). Kept apart from `Flight.actualRoute`, which is the
 * provider's line and is overwritten by every lookup.
 */
export interface FlightTrack {
  id: string;
  flightId: string;
  source: "companion";
  uploadId: string;
  deviceId: string | null;
  times: { startedAt: TimeValue; endedAt: TimeValue };
  /** Points of the raw recording, before simplification. */
  pointCount: number;
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

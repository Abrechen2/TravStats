import { API_URL, api } from "./client";
import type { DaySpan, InstantSpan, TrackPoint } from "./travtrack";

/**
 * The Track area's further views (TravTrack plan T5.3): a range of the map
 * for Monat / Jahr / Zeitraum, one point deleted by id, a flight's altitude
 * and speed, photos during a window, the stays across their states and the
 * Statistik calendar. Everything is read from the privacy-safe history: never
 * join two stretches, of one answer or of two parts.
 */

/** One part of a range read; ask again with `cursor` while it is set. */
export interface TravTrackRange {
  from: string;
  to: string;
  /** Simplified, privacy-safe stretches — never join two, nor those of two parts. */
  segments: TrackPoint[][];
  /** The stored point of each vertex, aligned with `segments` (for `deletePoint`). */
  pointIds: string[][];
  pointCount: number;
  readCount: number;
  simplified: boolean;
  /** Stretches left out to fit the vertex cap; normally 0. */
  omittedSegments: number;
  next: string | null;
  cursor: string | null;
}

/** `[tMs, altitudeM, speedMps]`; null where the phone gave none. */
export type FlightSample = [number, number | null, number | null];

export interface TravTrackFlightPanel {
  flightId: string;
  /** Stretches of samples; never join two. */
  series: FlightSample[][];
  pointCount: number;
  truncated: boolean;
  summary: {
    /** Null: not derivable — never shown as 0. */
    maxAltitudeM: number | null;
    maxSpeedMps: number | null;
    climbToCruiseMinutes: number | null;
  };
}

export interface TravTrackPhoto {
  assetId: string;
  type: "IMAGE" | "VIDEO";
  takenAt: string;
  /** On the own privacy-safe track at `takenAt`; never the photo's EXIF. */
  lat: number;
  lon: number;
}

export interface TravTrackPhotos {
  photos: TravTrackPhoto[];
  /** Not every photo of the window was considered (Immich's page, or the track read's bound). */
  truncated: boolean;
  /** The window's track was longer than one read; absent on an older server. */
  trackTruncated?: boolean;
}

export type TravTrackStayState = "pending" | "accepted" | "rejected";

export interface TravTrackStay {
  id: string;
  status: TravTrackStayState;
  provider: string;
  /** The first day on the stay's own zone's clock. */
  day: string;
  startAt: string;
  endAt: string;
  zone: string;
  /** Null inside a privacy zone. */
  position: { lat: number; lon: number } | null;
  name: string | null;
  place: { id: string; name: string } | null;
  tripId: string | null;
  visitId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface TravTrackStaysQuery extends Partial<DaySpan> {
  states?: TravTrackStayState[];
  cursor?: string;
  limit?: number;
}

export interface TravTrackCalendar {
  year: number;
  /** Days with data only: a day absent from a settled month was not recorded. */
  days: Array<{ day: string; kmGround: number; recorded: true }>;
  /** `YYYY-MM` still being prepared. */
  pending: string[];
  /** `YYYY-MM` whose day values are not known yet. */
  unavailable: string[];
}

/** A photo window, `[from, to)`, at most seven days. */
export type PhotoWindow = InstantSpan;

/** The Immich failure kind of a refused photo request, or null for any other failure. */
export function travTrackPhotoFailureKind(err: unknown): string | null {
  const data = (err as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
  return typeof data?.error === "string" ? data.error : null;
}

export const travTrackViewsApi = {
  /** One part of a span; pass the previous part's `cursor` for the next. */
  range: async (span: DaySpan | InstantSpan, cursor?: string | null): Promise<TravTrackRange> =>
    (
      await api.get<TravTrackRange>("/travtrack/range", {
        params: { ...span, ...(cursor ? { cursor } : {}) },
      })
    ).data,
  /** Deletes exactly one point; the count deleted (1). */
  deletePoint: async (pointId: string): Promise<number> =>
    (await api.delete<{ deleted: number }>(`/travtrack/points/${encodeURIComponent(pointId)}`)).data
      .deleted,
  flightPanel: async (flightId: string): Promise<TravTrackFlightPanel> =>
    (
      await api.get<TravTrackFlightPanel>(
        `/travtrack/flights/${encodeURIComponent(flightId)}/panel`
      )
    ).data,
  photos: async (window: PhotoWindow): Promise<TravTrackPhotos> =>
    (await api.get<TravTrackPhotos>("/travtrack/photos", { params: window })).data,
  /**
   * A placed photo's rendition for an `<img src>`, prefixed with `API_URL` like
   * the photo-journey strip. The window must be the list's: it is the grant.
   */
  photoUrl: (assetId: string, window: PhotoWindow, size: "thumbnail" | "preview" = "thumbnail") =>
    `${API_URL}/api/v1/travtrack/photos/${encodeURIComponent(assetId)}/file?${new URLSearchParams({ ...window, size }).toString()}`,
  stays: async (
    query: TravTrackStaysQuery = {}
  ): Promise<{ stays: TravTrackStay[]; nextCursor: string | null }> =>
    (
      await api.get<{ stays: TravTrackStay[]; nextCursor: string | null }>("/travtrack/stays", {
        params: {
          ...(query.states ? { status: query.states.join(",") } : {}),
          ...(query.fromDay ? { fromDay: query.fromDay, toDay: query.toDay } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        },
      })
    ).data,
  calendar: async (year: number): Promise<TravTrackCalendar> =>
    (await api.get<TravTrackCalendar>("/travtrack/calendar", { params: { year: String(year) } }))
      .data,
};

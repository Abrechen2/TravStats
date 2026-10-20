import { api } from "./client";
import type { DownloadedFile } from "./trackArchive";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";

/**
 * The Companion's trip recording (forgejo#316), `routes/trips/tripRecording.ts`.
 * The phone uploads; the web reads, downloads and deletes. Bare answers, like
 * every trip router.
 */

export interface TripRecordingView {
  summary: {
    pointCount: number;
    /** First and last point shown, on the trip's clock. */
    firstAt: TimeValue | null;
    lastAt: TimeValue | null;
    devices: string[];
    /** Every recorded day on the trip's clock, whatever `day` filtered to. */
    days: LocalDateValue[];
  };
  /** `[lon, lat]` lines, already cut at every gap — never join two. */
  segments: Array<Array<[number, number]>>;
}

function filenameFrom(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export const tripRecordingApi = {
  /** `day` (`YYYY-MM-DD` on the trip's clock) narrows the line and the summary; null shows all. */
  get: async (tripId: string, day: string | null): Promise<TripRecordingView> => {
    const { data } = await api.get<TripRecordingView>(`/trips/${tripId}/recording`, {
      params: day ? { day } : undefined,
    });
    return data;
  },

  downloadGpx: async (tripId: string): Promise<DownloadedFile> => {
    const res = await api.get<Blob>(`/trips/${tripId}/recording/gpx`, { responseType: "blob" });
    return {
      blob: res.data,
      filename: filenameFrom(res.headers["content-disposition"], "aufzeichnung.gpx"),
    };
  },

  remove: async (tripId: string): Promise<void> => {
    await api.delete(`/trips/${tripId}/recording`);
  },
};

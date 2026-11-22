import { api } from "./client";
import { waitForJob, type JobView } from "./jobs";

/**
 * The life book ("Lebensbuch"): one offline HTML chronicle of a year, a trip or
 * everything. Server side: `backend/src/routes/lifeBook.ts`.
 */

export type LifeBookScope =
  { scope: "all" } | { scope: "year"; year: number } | { scope: "trip"; tripId: string };

export interface LifeBookResult {
  exportId: string;
  filename: string;
  bytes: number;
  trips: number;
  entries: number;
  photos: number;
  /** Photographs the book is missing because they could not be read or fetched. */
  photosSkipped: number;
}

export const lifeBookApi = {
  /** Starts the build and waits for it; throws `JobFailedError` with the server's code. */
  build: async (
    request: LifeBookScope,
    lang: "de" | "en",
    onPoll?: (job: JobView<LifeBookResult>) => void
  ): Promise<LifeBookResult> => {
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>(
      "/me/life-book",
      { ...request, lang }
    );
    return waitForJob<LifeBookResult>(data.data.jobId, { onPoll });
  },

  download: async (exportId: string): Promise<Blob> => {
    const res = await api.get<Blob>(`/me/life-book/${exportId}`, {
      responseType: "blob",
      // A book with photos is larger than the client's default allows for.
      timeout: 0,
    });
    return res.data;
  },
};

import { api } from "./client";
import type { CruiseTrackOverview } from "../../types/cruiseTracks";

/**
 * Recorded tracks of a cruise (2.7), `routes/cruises/tracks.ts`. Every write
 * answers only the new id: the legs change with it, so the caller re-reads
 * the overview instead of patching a local copy.
 */
export const cruiseTracksApi = {
  overview: async (cruiseId: string): Promise<CruiseTrackOverview> => {
    const { data } = await api.get<{ success: true; data: CruiseTrackOverview }>(
      `/cruises/${cruiseId}/tracks`
    );
    return data.data;
  },

  /** Multipart field `file`, as on the tour upload — any other name reads as "no file". */
  upload: async (cruiseId: string, file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post<{ success: true; data: { id: string } }>(
      `/cruises/${cruiseId}/tracks`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return data.data.id;
  },

  /** One leg's window with `legOrdinal`, the whole voyage without. */
  pullDawarich: async (cruiseId: string, legOrdinal?: number): Promise<string> => {
    const { data } = await api.post<{ success: true; data: { id: string } }>(
      `/cruises/${cruiseId}/tracks/dawarich`,
      legOrdinal === undefined ? {} : { legOrdinal }
    );
    return data.data.id;
  },

  remove: async (cruiseId: string, trackId: string): Promise<void> => {
    await api.delete(`/cruises/${cruiseId}/tracks/${trackId}`);
  },
};

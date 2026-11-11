import { api } from "./client";

/**
 * The time gap that splits a recorded track (`GET/PUT /settings/track-gap`):
 * a recording is cut only where the phone recorded nothing for longer than
 * this, never by distance alone.
 */
export interface TrackGapSettings {
  minutes: number;
  default: number;
  min: number;
  max: number;
}

export const trackGapApi = {
  get: async (): Promise<TrackGapSettings> => {
    const { data } = await api.get<TrackGapSettings>("/settings/track-gap");
    return data;
  },
  set: async (minutes: number): Promise<TrackGapSettings> => {
    const { data } = await api.put<TrackGapSettings>("/settings/track-gap", { minutes });
    return data;
  },
};

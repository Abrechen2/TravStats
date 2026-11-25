import { api } from "./client";

/** `GET /travtrack/roadtrip-preview` (rc46 extras A, "Als Roadtrip übernehmen"). */
export interface PreviewStation {
  key: string;
  kind: "start" | "stop" | "end";
  name: string | null;
  nameSource: "place" | "stop" | null;
  placeId: string | null;
  lat: number;
  lon: number;
  arriveMs: number | null;
  departMs: number | null;
  dwellMs: number | null;
}

export interface PreviewLeg {
  fromKey: string;
  toKey: string;
  /** `[lon, lat]`, at most 256. */
  coordinates: [number, number][];
  /** Chords across recording gaps: drawn dashed, counted apart. */
  estimated: [number, number][][];
  distanceKm: number;
  estimatedKm: number;
}

export interface RoadtripPreview {
  stations: PreviewStation[];
  legs: PreviewLeg[];
  distanceKm: number;
  estimatedKm: number;
  zone: string;
}

/** A leg (`fromMs`/`untilMs`) or days on the profile clock, both inclusive. */
export type RoadtripSpan = { fromDay: string; toDay: string } | { fromMs: number; untilMs: number };

export const travTrackRoadtripApi = {
  preview: async (span: RoadtripSpan): Promise<RoadtripPreview> =>
    (await api.get<RoadtripPreview>("/travtrack/roadtrip-preview", { params: span })).data,
};

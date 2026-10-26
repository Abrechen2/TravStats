/**
 * Where a flight's or a trip's track came from (TravTrack plan T5): the own
 * recording (`travstats`), TravTrack or Dawarich. Additive on the track reads;
 * an older server leaves the fields out, which reads as the own recording.
 */
export type TrackOrigin = "travstats" | "travtrack" | "dawarich";
export type TrackCoverage = "complete" | "truncated" | "unreachable";

export interface TrackOriginInfo {
  origin: TrackOrigin | null;
  coverage: TrackCoverage | null;
  /** Other sources that may hold something for the entry; `?source=` shows one. */
  alternatives: TrackOrigin[];
  /** Alternatives offered without being read (Dawarich): "not checked yet", never "holds data". */
  unchecked: TrackOrigin[];
}

export const NO_ORIGIN_INFO: TrackOriginInfo = {
  origin: null,
  coverage: null,
  alternatives: [],
  unchecked: [],
};

/** The fields as an answer carries them, defaulted for a server that sends none. */
export function originInfoOf(raw: Partial<TrackOriginInfo> | null | undefined): TrackOriginInfo {
  return {
    origin: raw?.origin ?? null,
    coverage: raw?.coverage ?? null,
    alternatives: Array.isArray(raw?.alternatives) ? raw.alternatives : [],
    unchecked: Array.isArray(raw?.unchecked) ? raw.unchecked : [],
  };
}

import { api } from "./client";

/**
 * What location history asks the user (TravTrack plan E6/E7),
 * `/api/v1/location-suggestions`: the server's envelope — no evidence key, no
 * digest, no stored line. A journey question adds its runs, for the owner's
 * inbox only.
 */
export type JourneyEntryKind = "rail" | "bus" | "roadtrip";

export interface JourneyRun {
  index: number;
  fromMs: number;
  untilMs: number;
  /** Along the privacy-cut line. */
  km: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  /** False: the run began out of silence (or behind a privacy zone). */
  startRecorded: boolean;
  /** False: „Ende nicht aufgezeichnet“. */
  endRecorded: boolean;
  startZone: string;
  endZone: string;
  /** From the speed profile only — a hint for the form it opens. */
  modeHint: "rail" | "road" | "unknown";
  state: "open" | "linked" | "closed" | "invalidated";
  link: { entryKind: JourneyEntryKind; entryId: string } | null;
}

export interface LocationSuggestion {
  id: string;
  kind: "stay" | "market" | "venue" | "country" | "journey";
  provider: { kind: "travtrack" | "dawarich"; rev: number };
  /** `[fromMs, untilMs)`. */
  window: { fromMs: number; untilMs: number };
  algorithm: { name: string; version: number };
  /** `journey.unlogged`: `{ runs, km }`. */
  explanation: { code: string; params: Record<string, number | string> };
  status: "pending" | "accepted" | "rejected" | "invalidated" | "covered" | "superseded";
  coverage: "complete" | "truncated" | "unreachable" | null;
  /** A journey question's local day and runs. */
  journey?: { day: string; zone: string; runs: JourneyRun[] };
}

export interface JourneyAnswer {
  runIndex: number;
  entryKind: JourneyEntryKind;
  entryId: string;
}

const base = "/location-suggestions";

export const locationSuggestionsApi = {
  list: async (status = "pending"): Promise<LocationSuggestion[]> =>
    (await api.get(base, { params: { status } })).data.data,
  /** Link one run to the entry the user made for it. */
  acceptJourneyRun: async (id: string, answer: JourneyAnswer): Promise<LocationSuggestion> =>
    (await api.post(`${base}/${id}/accept`, answer)).data.data,
  /** Close one run (or, without `runIndex`, every open run) as needing no entry. */
  closeJourneyRuns: async (id: string, runIndex?: number): Promise<LocationSuggestion> =>
    (await api.post(`${base}/${id}/reject`, runIndex === undefined ? {} : { runIndex })).data.data,
};

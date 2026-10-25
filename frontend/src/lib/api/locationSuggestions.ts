import { api } from "./client";

/**
 * What location history asks the user (TravTrack plan E6): country questions
 * from TravTrack, `/api/v1/location-suggestions`. The server's envelope —
 * no evidence key, no digest, no position.
 */
export interface LocationSuggestion {
  id: string;
  kind: "stay" | "market" | "venue" | "country" | "journey";
  provider: { kind: "travtrack" | "dawarich"; rev: number };
  /** `[fromMs, untilMs)`; a country question covers whole UTC days. */
  window: { fromMs: number; untilMs: number };
  algorithm: { name: string; version: number };
  /** `country.groundDays`: `{ country, days, points }`. */
  explanation: { code: string; params: Record<string, number | string> };
  status: "pending" | "accepted" | "rejected" | "invalidated" | "covered" | "superseded";
  coverage: "complete" | "truncated" | "unreachable" | null;
}

export type CountryVerdict = "visited" | "ground";

const base = "/location-suggestions";

export const locationSuggestionsApi = {
  list: async (status = "pending"): Promise<LocationSuggestion[]> =>
    (await api.get(base, { params: { status } })).data.data,
  accept: async (id: string, verdict: CountryVerdict): Promise<LocationSuggestion> =>
    (await api.post(`${base}/${id}/accept`, { verdict })).data.data,
  reject: async (id: string): Promise<LocationSuggestion> =>
    (await api.post(`${base}/${id}/reject`, {})).data.data,
};

/** The first and last UTC day of a question's window, `YYYY-MM-DD`. */
export function suggestionDays(s: Pick<LocationSuggestion, "window">): {
  first: string;
  last: string;
} {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { first: day(s.window.fromMs), last: day(s.window.untilMs - 1) };
}

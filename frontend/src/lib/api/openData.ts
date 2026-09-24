import { isAxiosError } from "axios";

import { api } from "./client";
import type { TripJournalEntry } from "../../types";

/**
 * Open data (2.7): the day's weather for journal entries, the elevation
 * profile of a planned tour, Wikipedia summaries, and a lodging's facts from
 * OpenStreetMap. Every call answers 409 `openDataDisabled` while the instance
 * switch is off; callers check `openDataEnabled` from the settings store first.
 */

export interface PlannedProfile {
  distanceKm: number;
  ascentM: number | null;
  descentM: number | null;
  /** `[km, m]` pairs. */
  profile: Array<[number, number]>;
}

export interface WikipediaSummary {
  title: string;
  extract: string;
  thumbnailUrl: string | null;
  pageUrl: string;
  lang: "de" | "en";
}

export type EnrichedField = "stars" | "website" | "wikidataId" | "chain";

export interface LodgingEnrichment {
  found: boolean;
  reason: "noCoordinates" | "notFound" | null;
  osmRef: string | null;
  osmName: string | null;
  filled: EnrichedField[];
}

/** The two editions the backend serves; anything else asks for English. */
export function wikiLanguage(language: string | undefined): "de" | "en" {
  return language?.toLowerCase().startsWith("de") ? "de" : "en";
}

/** True when the failure is the instance's switch being off, not an error. */
export function isOpenDataDisabled(error: unknown): boolean {
  return (
    isAxiosError(error) &&
    error.response?.status === 409 &&
    (error.response.data as { error?: unknown } | undefined)?.error === "openDataDisabled"
  );
}

export const openDataApi = {
  fillJournalWeather: async (
    tripId: string
  ): Promise<{ filled: number; entries: TripJournalEntry[] }> =>
    (await api.post(`/trips/${tripId}/journal/weather`)).data,

  refreshEntryWeather: async (tripId: string, entryId: string): Promise<TripJournalEntry> =>
    (await api.post(`/trips/${tripId}/journal/${entryId}/weather`)).data.entry,

  plannedProfile: async (routeId: string): Promise<PlannedProfile | null> =>
    (await api.get(`/tours/${routeId}/planned-profile`)).data.profile,

  placeWikipedia: async (placeId: string, lang: "de" | "en"): Promise<WikipediaSummary | null> =>
    (await api.get(`/places/${placeId}/wikipedia`, { params: { lang } })).data.summary,

  lodgingWikipedia: async (
    lodgingId: string,
    lang: "de" | "en"
  ): Promise<WikipediaSummary | null> =>
    (await api.get(`/lodging/${lodgingId}/wikipedia`, { params: { lang } })).data.summary,

  enrichLodging: async (lodgingId: string): Promise<LodgingEnrichment> =>
    (await api.post(`/lodging/${lodgingId}/enrich`)).data,
};

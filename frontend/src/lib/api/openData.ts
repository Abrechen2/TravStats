import { isAxiosError } from "axios";

import { api } from "./client";
import { waitForJob } from "./jobs";
import type { TripJournalEntry } from "../../types";
import type { LodgingChain } from "../../types/lodging";

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

/**
 * What a weather lookup came to (server `WeatherOutcome`). The last three are
 * failures of Open-Meteo, not facts about the day: the stored weather is kept.
 */
export type WeatherOutcome =
  | "observed"
  | "noLocation"
  | "futureOrToday"
  | "noData"
  | "timeout"
  | "rateLimited"
  | "unavailable"
  | "disabled";

export const WEATHER_SERVICE_FAILURES: ReadonlySet<WeatherOutcome> = new Set<WeatherOutcome>([
  "timeout",
  "rateLimited",
  "unavailable",
]);

export interface EntryWeatherOutcome {
  entryId: string;
  date: string;
  outcome: WeatherOutcome;
}

export type EnrichedField = "stars" | "website" | "wikidataId" | "chain";

export interface LodgingEnrichment {
  found: boolean;
  /** `timeout`, `rateLimited` and `unavailable` mean OpenStreetMap could not be
   *  asked — NOT that it does not know the house. */
  reason: "noCoordinates" | "notFound" | "timeout" | "rateLimited" | "unavailable" | null;
  osmRef: string | null;
  osmName: string | null;
  filled: EnrichedField[];
}

/** A place to sleep near a point, from OpenStreetMap (`GET /nearby/lodging`). */
export interface NearbyLodging {
  name: string;
  /** The OSM `tourism` value: hotel, guest_house, camp_site, … */
  kind: string;
  lat: number;
  lon: number;
  distanceM: number;
  osmRef: string;
  website: string | null;
  stars: number | null;
  brand: string | null;
  /** The catalogue chain named like `brand`, when the catalogue has one. */
  chain: LodgingChain | null;
}

/**
 * Per-call client timeouts that cover the server's own budget (2026-09-26).
 * The default ten seconds is shorter than Overpass's 20–25 s and than an
 * Open-Meteo call plus the database, so the browser gave up first and the UI
 * said "OpenStreetMap does not know this house" about a server still asking.
 */
export const OPEN_DATA_CLIENT_TIMEOUT_MS = {
  /** Server: one Open-Meteo request, 8 s. */
  weather: 20_000,
  /** Server: Overpass up to 25 s (nearby) or 20 s plus the OSM API (enrich). */
  overpass: 45_000,
} as const;

/** Why the server could not ask an open data service (`code` of a 502/503/504). */
export type OpenDataUpstreamFailure = "timeout" | "rateLimited" | "unavailable";

/** The upstream failure a 5xx names, or null for anything else (a client-side
 *  timeout included — the server may still be asking). */
export function openDataUpstreamFailure(
  error: unknown
): OpenDataUpstreamFailure | "clientTimeout" | null {
  if (!isAxiosError(error)) return null;
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "clientTimeout";
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  if (code === "UPSTREAM_TIMEOUT") return "timeout";
  if (code === "UPSTREAM_RATE_LIMITED") return "rateLimited";
  if (code === "UPSTREAM_UNAVAILABLE") return "unavailable";
  return null;
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
  /**
   * A server job (2026-09-26): one Open-Meteo call per entry, up to eight
   * seconds each, used to run inside one request the client dropped after ten.
   */
  fillJournalWeather: async (
    tripId: string
  ): Promise<{ filled: number; outcomes: EntryWeatherOutcome[]; entries: TripJournalEntry[] }> => {
    const { data } = await api.post<{ jobId: string }>(`/trips/${tripId}/journal/weather`, {
      background: true,
    });
    return waitForJob(data.jobId);
  },

  refreshEntryWeather: async (
    tripId: string,
    entryId: string
  ): Promise<{ entry: TripJournalEntry; weatherOutcome: WeatherOutcome }> =>
    (
      await api.post(`/trips/${tripId}/journal/${entryId}/weather`, undefined, {
        timeout: OPEN_DATA_CLIENT_TIMEOUT_MS.weather,
      })
    ).data,

  plannedProfile: async (routeId: string): Promise<PlannedProfile | null> =>
    (await api.get(`/tours/${routeId}/planned-profile`)).data.profile,

  placeWikipedia: async (placeId: string, lang: "de" | "en"): Promise<WikipediaSummary | null> =>
    (await api.get(`/places/${placeId}/wikipedia`, { params: { lang } })).data.summary,

  lodgingWikipedia: async (
    lodgingId: string,
    lang: "de" | "en"
  ): Promise<WikipediaSummary | null> =>
    (await api.get(`/lodging/${lodgingId}/wikipedia`, { params: { lang } })).data.summary,

  nearbyLodgings: async (lat: number, lon: number, radiusKm: number): Promise<NearbyLodging[]> =>
    (
      await api.get("/nearby/lodging", {
        params: { lat, lon, radiusKm },
        timeout: OPEN_DATA_CLIENT_TIMEOUT_MS.overpass,
      })
    ).data.places,

  enrichLodging: async (lodgingId: string): Promise<LodgingEnrichment> =>
    (
      await api.post(`/lodging/${lodgingId}/enrich`, undefined, {
        timeout: OPEN_DATA_CLIENT_TIMEOUT_MS.overpass,
      })
    ).data,
};

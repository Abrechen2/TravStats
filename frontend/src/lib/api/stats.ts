import type { TravelAccountResponse } from "../../types/travelAccount";
import type { CountryDetail, Passport } from "../../types/passport";
import type { TravelRecord, TravelRecordsResponse } from "../../types/travelRecords";
import type { Wrapped } from "../../types/wrapped";
import type {
  AircraftProfileResponse,
  AircraftRankingResponse,
  AirlineRankingResponse,
  AirportStats,
  BusinessStats,
  CountryStatsResponse,
  FunStats,
  Route,
  SeatStats,
  UniqueStats,
} from "../../types";

import { api } from "./client";
import type { SummaryParams, SummaryResponse, TimeseriesParams, TimeseriesResponse } from "./types";

/**
 * The sections `GET /stats/page` can compose, and the shape of each — every
 * one the response type of the endpoint it is named after, so a section and
 * its endpoint cannot be typed differently here either.
 *
 * MIRRORS `backend/src/schemas/statsPage.ts`; change both together.
 */
export interface StatsPageSections {
  fun: FunStats;
  business: BusinessStats;
  unique: UniqueStats;
  airports: AirportStats;
  seats: SeatStats;
  countries: CountryStatsResponse;
  airlines: AirlineRankingResponse;
  aircraft: AircraftRankingResponse;
  punctuality: PunctualityStats;
}

export type StatsPageSection = keyof StatsPageSections;

// Stats API
export const statsApi = {
  /**
   * The cross-domain night account plus the per-trip rollup — one request
   * because a screen asking "where did I sleep" asks "which trip has a gap"
   * next, and two round-trips for one question is two chances to show half
   * an answer.
   */
  /**
   * The passport. Derived server-side on purpose: the mobile app draws the same
   * screen, and two client-side derivations of one set of numbers drift.
   */
  getPassport: async (): Promise<Passport> => {
    const { data } = await api.get<Passport>("/stats/passport");
    return data;
  },

  /**
   * One country's records, so a passport row's provenance can be OPENED and not
   * only read. A row states that a flight or a place proved the country; this
   * names which one, and the id is what the link needs.
   */
  getCountryDetail: async (code: string): Promise<CountryDetail> => {
    const { data } = await api.get<CountryDetail>(`/stats/countries/${encodeURIComponent(code)}`);
    return data;
  },

  /**
   * The seven travel records, derived server-side (forgejo#41).
   *
   * The envelope is unwrapped HERE and nowhere else. `/stats/records` is one
   * of the twelve `{success, data}` leaks the response-shape ratchet records,
   * and a screen that had to know which of the two shapes its endpoint speaks
   * is a screen that will eventually guess wrong.
   */
  getRecords: async (): Promise<TravelRecord[]> => {
    const { data } = await api.get<TravelRecordsResponse>("/stats/records");
    return data.data.records;
  },

  /**
   * The year in review (forgejo#42).
   *
   * Omitting `year` is not the same as passing the current one: without it the
   * server answers about the latest year that HAS anything in it, read off the
   * data rather than off the wall clock. The page relies on that for its first
   * load and only sends a year once the reader picks one.
   *
   * 404 when the account has no countable activity in any year at all — there
   * is no story, and `classifyLoadFailure` lets the page tell that apart from
   * a load that failed.
   */
  getWrapped: async (year?: number): Promise<Wrapped> => {
    const { data } = await api.get<Wrapped>("/stats/wrapped", {
      params: year === undefined ? undefined : { year },
    });
    return data;
  },

  getTravelAccount: async (): Promise<TravelAccountResponse> => {
    const { data } = await api.get<TravelAccountResponse>("/stats/travel-account");
    return data;
  },
  /**
   * Several sections, from ONE pass over the flight table (forgejo#49).
   *
   * Measured on this page before the endpoint existed: the flight tab issued
   * twelve `/stats/*` requests and the server answered them with fifteen scans
   * of the flight table, thirteen over the identical population. Nine of those
   * requests share one load, and this is how they ask for it.
   *
   * The nine per-section endpoints are still served and are still what a
   * client wanting ONE figure should call — the Companion does, and so does
   * the evidence panel. Each section here is identical to its own endpoint's
   * body, which a backend test asserts by fetching both.
   */
  getStatsPage: async <S extends StatsPageSection>(
    include: readonly S[]
  ): Promise<Pick<StatsPageSections, S>> => {
    const { data } = await api.get<Pick<StatsPageSections, S>>("/stats/page", {
      params: { include: include.join(",") },
    });
    return data;
  },

  getSummary: async (params?: SummaryParams): Promise<SummaryResponse> => {
    const { data } = await api.get<SummaryResponse>("/stats/summary", { params });
    return data;
  },

  getTimeseries: async (params?: TimeseriesParams): Promise<TimeseriesResponse> => {
    const { data } = await api.get<TimeseriesResponse>("/stats/timeseries", { params });
    return data;
  },

  getTopRoutes: async (limit = 10): Promise<{ routes: Route[] }> => {
    const { data } = await api.get<{ routes: Route[] }>("/stats/routes", {
      params: { limit },
    });
    return data;
  },

  getCountryStats: async (): Promise<CountryStatsResponse> => {
    const { data } = await api.get<CountryStatsResponse>("/stats/countries");
    return data;
  },

  // The eight one-line wrappers for /stats/fun, /business, /unique, /airports,
  // /seats, /airlines, /aircraft and /punctuality were DELETED with forgejo#49:
  // the statistics page reads all nine of those sections through
  // `getStatsPage` in one request, and nothing else in this app called them.
  // The ENDPOINTS are all still served — the Companion reads them and the
  // evidence panel cross-checks against them — so a future consumer adds the
  // wrapper it needs rather than finding eight unused ones. `getCountryStats`
  // below stayed for the same reason in reverse: `useDomainStats` still calls it
  // on every tab.

  /** `year` scopes to cruises that STARTED in it; omitted, the lifetime view. */
  getCruiseStats: async (params?: { year?: number }): Promise<CruiseStatsResponse> => {
    const year = params?.year;
    const { data } =
      year === undefined
        ? await api.get<CruiseStatsResponse>("/stats/cruise")
        : await api.get<CruiseStatsResponse>("/stats/cruise", { params: { year } });
    return data;
  },

  getAircraftProfile: async (registration: string): Promise<AircraftProfileResponse> => {
    const { data } = await api.get<AircraftProfileResponse>(
      `/stats/aircraft/${encodeURIComponent(registration)}`
    );
    return data;
  },
};

export interface PunctualityGroup {
  key: string;
  avgDelayMinutes: number;
  flights: number;
}
export interface PunctualityStats {
  sampleSize: number;
  avgDelayMinutes: number;
  onTimeRate: number;
  bestAirline: PunctualityGroup | null;
  worstAirline: PunctualityGroup | null;
  worstRoute: PunctualityGroup | null;
}

/** Shape returned by GET /api/v1/stats/cruise. */
export interface CruiseStatsResponse {
  // Counts + ladders
  cruisesCount: number;
  cruisePortsUnique: number;
  cruisePortsSingleMax: number;
  cruiseShipsUnique: number;
  cruiseLinesUnique: number;
  cruiseLineLoyaltyMax: number;
  cruiseLines: string[];
  seaDays: number;
  seaDaysStreak: number;
  // Regions + countries
  regions: string[];
  regionVisitCounts: Record<string, number>;
  /** Display vocabulary: English names, rendered in the cruise tab's tag
   *  cloud. */
  countries: string[];
  /** Counting vocabulary: the same set as ISO alpha-2, for unioning with the
   *  airport catalogue. Optional so an older backend still parses. */
  countriesIso?: string[];
  /** Countries keyed by the cruise's start year, ISO vocabulary. Optional so
   *  an older backend still parses. */
  countriesByYear?: Record<string, string[]>;
  // Distance metrics
  totalDistanceKm: number;
  longestLegKm: number;
  // Trip-shape derivations
  totalPortCalls: number;
  /** Port calls that matched a catalogue port. Unresolved calls count towards
   *  `totalPortCalls` but can never enter `cruisePortsUnique`, so a ratio
   *  between those two needs this denominator or it reads them as revisits. */
  resolvedPortCalls: number;
  totalCruiseDays: number;
  // Cabin / deck
  hasBalconyCabin: boolean;
  hasSuiteCabin: boolean;
  maxDeck: number;
  // Achievement-style flags
  hasCanalTransit: boolean;
  hasPolar: boolean;
  hasColdWater: boolean;
  hasDatelineCrossing: boolean;
  hasBirthdayAtSea: boolean;
  hasNewYearsAtSea: boolean;
  /** The base-currency total behind the money section's one summed figure.
   *  Optional so an older backend still parses — without it the tile is not
   *  drawn at all, which is the honest answer when nobody computed it. */
  totalSpendBase?: CruiseTotalSpendBase;
}

/**
 * The converted cruise total, as `GET /stats/cruise` answers it.
 *
 * Computed on the server by `services/stats/cruiseSpendBase.ts`, the same rule
 * the evidence panel answers `metric:cruiseTotalSpend` with. It is NOT folded
 * on the client: the cruise rows carry a price and a currency, and the FX
 * snapshot that makes a sum honest lives on columns the rows endpoint does not
 * expose. `value` is null — never 0 — when nothing in scope could be
 * converted, and `excludedCount` names how many priced cruises stayed out.
 */
export interface CruiseTotalSpendBase {
  value: number | null;
  excludedCount: number;
  currency: string;
}

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

// Stats API
export const statsApi = {
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

  getFunStats: async (filters?: { fromDate?: string; toDate?: string }): Promise<FunStats> => {
    const { data } = await api.get<FunStats>("/stats/fun", { params: filters });
    return data;
  },

  getBusinessStats: async (filters?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<BusinessStats> => {
    const { data } = await api.get<BusinessStats>("/stats/business", {
      params: filters,
    });
    return data;
  },

  getUniqueStats: async (filters?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<UniqueStats> => {
    const { data } = await api.get<UniqueStats>("/stats/unique", {
      params: filters,
    });
    return data;
  },

  getAirportStats: async (filters?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<AirportStats> => {
    const { data } = await api.get<AirportStats>("/stats/airports", {
      params: filters,
    });
    return data;
  },

  getSeatStats: async (filters?: { fromDate?: string; toDate?: string }): Promise<SeatStats> => {
    const { data } = await api.get<SeatStats>("/stats/seats", {
      params: filters,
    });
    return data;
  },

  getAirlineRanking: async (): Promise<AirlineRankingResponse> => {
    const { data } = await api.get<AirlineRankingResponse>("/stats/airlines");
    return data;
  },

  getCountryStats: async (): Promise<CountryStatsResponse> => {
    const { data } = await api.get<CountryStatsResponse>("/stats/countries");
    return data;
  },

  getCruiseStats: async (): Promise<CruiseStatsResponse> => {
    const { data } = await api.get<CruiseStatsResponse>("/stats/cruise");
    return data;
  },

  getAircraftRanking: async (): Promise<AircraftRankingResponse> => {
    const { data } = await api.get<AircraftRankingResponse>("/stats/aircraft");
    return data;
  },

  getAircraftProfile: async (registration: string): Promise<AircraftProfileResponse> => {
    const { data } = await api.get<AircraftProfileResponse>(
      `/stats/aircraft/${encodeURIComponent(registration)}`
    );
    return data;
  },

  getPunctuality: async (filters?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<PunctualityStats> => {
    const { data } = await api.get<PunctualityStats>("/stats/punctuality", { params: filters });
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
}

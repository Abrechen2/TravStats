import type {
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
import type { SummaryParams, SummaryResponse } from "./types";

// Stats API
export const statsApi = {
  getSummary: async (params?: SummaryParams): Promise<SummaryResponse> => {
    const { data } = await api.get<SummaryResponse>("/stats/summary", { params });
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
};

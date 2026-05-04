import type {
  Flight,
  FlightFilters,
  FlightInput,
  GeoJSONFeatureCollection,
  UserAchievement,
} from "../../types";

import { api } from "./client";

// Flights API
export const flightsApi = {
  getAll: async (
    filters?: FlightFilters
  ): Promise<{
    flights: Flight[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const { data } = await api.get<{
      flights: Flight[];
      total: number;
      limit: number;
      offset: number;
    }>("/flights", { params: filters });
    return data;
  },

  getGeoJSON: async (filters?: FlightFilters): Promise<GeoJSONFeatureCollection> => {
    const { data } = await api.get<GeoJSONFeatureCollection>("/flights/geo", {
      params: filters,
    });
    return data;
  },

  getById: async (id: string): Promise<Flight> => {
    const { data } = await api.get<Flight>(`/flights/${id}`);
    return data;
  },

  create: async (
    flight: FlightInput,
    opts: { force?: boolean; merge?: boolean } = {}
  ): Promise<Flight> => {
    const params = new URLSearchParams();
    if (opts.force) params.set("force", "true");
    else if (opts.merge) params.set("merge", "true");
    const qs = params.toString();
    const { data } = await api.post<Flight>(`/flights${qs ? `?${qs}` : ""}`, flight);
    return data;
  },

  // Updates accept the canonical-UTC submit contract — partial FlightInput
  // (with departureLocal + depTimezone pairs). Partial<Flight> is rejected
  // server-side because departureTime/arrivalTime are no longer recognized.
  update: async (id: string, flight: Partial<FlightInput>): Promise<Flight> => {
    const { data } = await api.put<Flight>(`/flights/${id}`, flight);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/flights/${id}`);
  },

  createBatch: async (
    flights: FlightInput[]
  ): Promise<{ flights: Flight[]; count: number; newAchievements?: UserAchievement[] }> => {
    const { data } = await api.post<{
      flights: Flight[];
      count: number;
      newAchievements?: UserAchievement[];
    }>("/flights/batch", flights);
    return data;
  },

  // Bulk historical refresh — pre-flight count of refreshable flights.
  // Returns 403 with `error: 'DEMO_ACCOUNT_FORBIDDEN'` for seeded demo
  // accounts so the UI can disable the button with an explanatory tooltip.
  bulkRefreshPreview: async (): Promise<{
    remaining: number;
    hasHistoricalProvider: boolean;
    aerodataboxQuota: AerodataboxQuota | null;
  }> => {
    const { data } = await api.get<{
      remaining: number;
      hasHistoricalProvider: boolean;
      aerodataboxQuota: AerodataboxQuota | null;
    }>("/flights/refresh-historical-bulk/preview");
    return data;
  },

  bulkRefreshRun: async (): Promise<BulkRefreshSummary> => {
    const { data } = await api.post<BulkRefreshSummary>(
      "/flights/refresh-historical-bulk"
    );
    return data;
  },
};

export interface AerodataboxQuota {
  limit: number | null;
  remaining: number | null;
  observedAt: string;
}

export interface BulkRefreshSummary {
  scanned: number;
  updated: number;
  noData: number;
  failed: number;
  remaining: number;
  results: Array<{
    flightId: string;
    flightNumber: string;
    outcome: "updated" | "no_data" | "failed";
    fieldsUpdated?: string[];
    error?: string;
  }>;
  aerodataboxQuota?: AerodataboxQuota | null;
}

import type {
  Flight,
  FlightFilters,
  FlightInput,
  FlightLookupResult,
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

  create: async (flight: FlightInput, force = false): Promise<Flight> => {
    const { data } = await api.post<Flight>(`/flights${force ? "?force=true" : ""}`, flight);
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

  lookup: async (params: { flightNumber: string; date?: string }): Promise<FlightLookupResult> => {
    const { data } = await api.get<FlightLookupResult>("/flights/lookup", { params });
    return data;
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
};

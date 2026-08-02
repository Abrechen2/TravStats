import { api } from "./client";
import type { Airport } from "./types";

// Airport API
export const airportsApi = {
  search: async (query: string): Promise<Airport[]> => {
    const { data } = await api.get<Airport[]>("/airports/search", {
      params: { q: query },
    });
    return data;
  },

  getByCode: async (code: string): Promise<Airport> => {
    const { data } = await api.get<Airport>(`/airports/${code}`);
    return data;
  },

  /** Manual airport creation (#191) — admin master-data page. The timezone
   *  is derived server-side from the coordinates; isUserAdded rows survive
   *  CSV re-seeds. */
  create: async (input: {
    name: string;
    iata?: string;
    icao?: string;
    city?: string;
    country?: string;
    lat: number;
    lon: number;
    altitude?: number;
  }): Promise<Airport> => {
    const { data } = await api.post<{ success: boolean; data: Airport }>("/airports", input);
    return data.data;
  },
};

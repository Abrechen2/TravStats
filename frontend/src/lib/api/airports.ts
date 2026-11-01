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

  /**
   * Fetch an airport missing from the catalogue from the external source (and
   * store it). `POST /airports/enrich`: 404 = no source knows the code,
   * 503 `AIRPORT_LOOKUP_UNAVAILABLE` = no source could be asked.
   */
  enrich: async (code: string): Promise<Airport> => {
    const trimmed = code.trim();
    const body = trimmed.length === 4 ? { icao: trimmed } : { iata: trimmed };
    const { data } = await api.post<Airport>("/airports/enrich", body);
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

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
};

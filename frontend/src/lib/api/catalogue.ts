import { api } from "./client";
import type { Aircraft, Airline } from "../../types";

interface Envelope<T> {
  success: boolean;
  data: T;
  /** Catalogue size for the same filter — lets list UIs show "50 of 1125". */
  total?: number;
}

export interface CatalogueList<T> {
  items: T[];
  total: number;
}

export interface AirlineInput {
  iata?: string;
  icao?: string;
  name: string;
  callsign?: string;
  country?: string;
}

export interface AircraftInput {
  icao?: string;
  name: string;
}

export const airlinesApi = {
  search: async (q: string): Promise<Airline[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Airline[]>>("/airlines", { params });
    return data.data;
  },
  /** Like search, but keeps the server-side total for truncation hints. */
  list: async (q: string): Promise<CatalogueList<Airline>> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Airline[]>>("/airlines", { params });
    return { items: data.data, total: data.total ?? data.data.length };
  },
  create: async (input: AirlineInput): Promise<Airline> => {
    const { data } = await api.post<Envelope<Airline>>("/airlines", input);
    return data.data;
  },
};

export const aircraftApi = {
  search: async (q: string): Promise<Aircraft[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Aircraft[]>>("/aircraft", { params });
    return data.data;
  },
  /** Like search, but keeps the server-side total for truncation hints. */
  list: async (q: string): Promise<CatalogueList<Aircraft>> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Aircraft[]>>("/aircraft", { params });
    return { items: data.data, total: data.total ?? data.data.length };
  },
  create: async (input: AircraftInput): Promise<Aircraft> => {
    const { data } = await api.post<Envelope<Aircraft>>("/aircraft", input);
    return data.data;
  },
};

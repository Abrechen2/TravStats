import { api } from "./client";
import type { Aircraft, Airline } from "../../types";

interface Envelope<T> {
  success: boolean;
  data: T;
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
  create: async (input: AircraftInput): Promise<Aircraft> => {
    const { data } = await api.post<Envelope<Aircraft>>("/aircraft", input);
    return data.data;
  },
};

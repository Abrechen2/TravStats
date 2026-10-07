import { api } from "./client";
import type { BusEntrySuggestions, BusJourney, BusJourneyInput } from "../../types/bus";

/** `/api/v1/bus` — the bus logbook (spec 2026-10-07-bus-domain-design). Enveloped. */

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** The summary strip's figures over the whole FILTERED list, counted by the server. */
export interface BusListSummary {
  journeys: number;
  operators: number;
  withoutOperator: number;
  stations: number;
}

export interface BusPage {
  journeys: BusJourney[];
  total: number;
  summary: BusListSummary;
}

export interface BusListQuery {
  q?: string;
  year?: number;
  status?: string;
  tripId?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const busApi = {
  async list(query: BusListQuery = {}): Promise<BusPage> {
    const res = await api.get<
      Envelope<BusJourney[]> & { meta: { total: number; summary: BusListSummary } }
    >("/bus", { params: query });
    return { journeys: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
  },

  /** Every ride matching `query`, a page of 500 (the endpoint's cap) at a time. */
  async listAll(query: Omit<BusListQuery, "limit" | "offset"> = {}): Promise<BusJourney[]> {
    const PAGE = 500;
    const rides: BusJourney[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await busApi.list({ ...query, limit: PAGE, offset });
      rides.push(...page.journeys);
      if (page.journeys.length < PAGE || rides.length >= page.total) return rides;
    }
  },

  async get(id: string): Promise<BusJourney> {
    const res = await api.get<Envelope<BusJourney>>(`/bus/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  async create(input: BusJourneyInput): Promise<BusJourney> {
    const res = await api.post<Envelope<BusJourney>>("/bus", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<BusJourneyInput>): Promise<BusJourney> {
    const res = await api.patch<Envelope<BusJourney>>(`/bus/${encodeURIComponent(id)}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/bus/${encodeURIComponent(id)}`);
  },

  /** What the form may offer from the user's own rides (Task 6b); chips only fill a field on a click. */
  async entrySuggestions(query: {
    depName?: string;
    arrName?: string;
    operator?: string;
  }): Promise<BusEntrySuggestions> {
    const res = await api.get<Envelope<BusEntrySuggestions>>("/bus/entry-suggestions", {
      params: query,
    });
    return res.data.data;
  },
};

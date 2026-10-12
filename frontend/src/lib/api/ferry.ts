import { api } from "./client";
import type { FerryJourney } from "../../types/ferry";
interface Envelope<T> {
  success: boolean;
  data: T;
}
export interface FerryRoadtripLeg {
  id: string;
  mode: string;
  ferryJourney: { id: string } | null;
  fromStop: { title: string };
  toStop: { title: string };
  route: { name: string; tripId: string | null };
}
export interface FerryListSummary {
  journeys: number;
  operators: number;
  withoutOperator: number;
  stations: number;
}

export interface FerryPage {
  journeys: FerryJourney[];
  total: number;
  summary: FerryListSummary;
}

export interface FerryListQuery {
  q?: string;
  year?: number;
  status?: string;
  tripId?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const ferryApi = {
  async roadtripLegs() {
    return (await api.get<Envelope<FerryRoadtripLeg[]>>("/ferry/roadtrip-legs")).data.data;
  },
  async linkLeg(id: string, legId: string | null) {
    await api.put(`/ferry/${encodeURIComponent(id)}/roadtrip-leg`, { legId });
  },
  async list(query: FerryListQuery = {}): Promise<FerryPage> {
    const res = await api.get<
      Envelope<FerryJourney[]> & { meta: { total: number; summary: FerryListSummary } }
    >("/ferry", { params: query });
    return { journeys: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
  },

  /** Every ride matching `query`, a page of 500 (the endpoint's cap) at a time. */
  async listAll(query: Omit<FerryListQuery, "limit" | "offset"> = {}): Promise<FerryJourney[]> {
    const PAGE = 500;
    const rides: FerryJourney[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await ferryApi.list({ ...query, limit: PAGE, offset });
      rides.push(...page.journeys);
      if (page.journeys.length < PAGE || rides.length >= page.total) return rides;
    }
  },

  async get(id: string) {
    return (await api.get<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}`)).data.data;
  },
  async save(id: string | null, input: unknown) {
    const response = id
      ? await api.patch<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}`, input)
      : await api.post<Envelope<FerryJourney>>("/ferry", input);
    return response.data.data;
  },
  async remove(id: string) {
    await api.delete(`/ferry/${encodeURIComponent(id)}`);
  },
};

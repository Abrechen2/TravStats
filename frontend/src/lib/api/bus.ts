import { api } from "./client";
import type {
  BusEntrySuggestions,
  BusGeometryReport,
  BusJourney,
  BusJourneyInput,
  BusRouteAllResult,
  BusRoutingAvailability,
  BusStats,
} from "../../types/bus";
import { waitForJob } from "./jobs";

/** `/api/v1/bus` — the bus logbook (spec 2026-10-07-bus-domain-design). Enveloped. */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface SavedBusRide {
  ride: BusJourney;
  /** Null from a server that predates road routing. */
  geometry: BusGeometryReport | null;
}

interface WriteEnvelope extends Envelope<BusJourney> {
  meta?: { geometry?: BusGeometryReport };
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
    return (await busApi.createReported(input)).ride;
  },

  async update(id: string, input: Partial<BusJourneyInput>): Promise<BusJourney> {
    return (await busApi.updateReported(id, input)).ride;
  },

  /** A create, with what it did to the road line (`meta.geometry`) beside the ride. */
  async createReported(input: BusJourneyInput): Promise<SavedBusRide> {
    const res = await api.post<WriteEnvelope>("/bus", input);
    return { ride: res.data.data, geometry: res.data.meta?.geometry ?? null };
  },

  async updateReported(id: string, input: Partial<BusJourneyInput>): Promise<SavedBusRide> {
    const res = await api.patch<WriteEnvelope>(`/bus/${encodeURIComponent(id)}`, input);
    return { ride: res.data.data, geometry: res.data.meta?.geometry ?? null };
  },

  /** Can this instance route along roads at all? Without a provider every ride stays a straight line. */
  async routing(): Promise<BusRoutingAvailability> {
    const res = await api.get<Envelope<BusRoutingAvailability>>("/bus/routing");
    return res.data.data;
  },

  /** "Route again": the road line for one straight ride. A provider that fails answers 200 with its reason. */
  async routeAgain(id: string): Promise<SavedBusRide> {
    const res = await api.post<WriteEnvelope>(`/bus/${encodeURIComponent(id)}/route`);
    return { ride: res.data.data, geometry: res.data.meta?.geometry ?? null };
  },

  /** Every straight ride, as a background job; resolves with each ride's outcome. */
  async routeAll(
    onProgress?: (progress: { done: number; total: number } | null) => void
  ): Promise<BusRouteAllResult> {
    const res = await api.post<Envelope<{ jobId: string }>>("/bus/route-straight");
    return waitForJob<BusRouteAllResult>(res.data.data.jobId, {
      onPoll: (job) => onProgress?.(job.progress),
    });
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

  /**
   * `GET /bus/stats` (forgejo#263) — the year a ride left in, optionally cut
   * at "MM-DD" so a running year is compared with the same span of another.
   */
  async stats(year: number | null, until: string | null = null): Promise<BusStats> {
    const params: Record<string, string | number> = {};
    if (year !== null) params.year = year;
    if (until !== null) params.until = until;
    const res = await api.get<Envelope<BusStats>>("/bus/stats", { params });
    return res.data.data;
  },
};

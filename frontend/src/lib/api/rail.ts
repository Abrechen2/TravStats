import { api } from "./client";
import type {
  RailJourney,
  RailJourneyInput,
  RailLookupAnswer,
  RailLookupProviders,
  RailStationHit,
} from "../../types/rail";

/**
 * `/api/v1/rail` — the rail logbook (spec 2026-09-25-rail-domain). Enveloped,
 * like every newer domain's router.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface RailPage {
  journeys: RailJourney[];
  total: number;
}

export interface RailListQuery {
  q?: string;
  year?: number;
  status?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const railApi = {
  async list(query: RailListQuery = {}): Promise<RailPage> {
    const res = await api.get<Envelope<RailJourney[]> & { meta: { total: number } }>("/rail", {
      params: query,
    });
    return { journeys: res.data.data, total: res.data.meta.total };
  },

  async create(input: RailJourneyInput): Promise<RailJourney> {
    const res = await api.post<Envelope<RailJourney>>("/rail", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<RailJourneyInput>): Promise<RailJourney> {
    const res = await api.patch<Envelope<RailJourney>>(`/rail/${id}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/rail/${id}`);
  },

  /** The station catalogue typeahead; `q` needs two characters. */
  async searchStations(q: string, limit = 12): Promise<RailStationHit[]> {
    const res = await api.get<Envelope<RailStationHit[]>>("/rail/stations", {
      params: { q, limit },
    });
    return res.data.data;
  },

  /** Which lookup providers the admin allows on this instance. */
  async lookupProviders(): Promise<RailLookupProviders> {
    const res = await api.get<Envelope<RailLookupProviders>>("/rail/lookup/providers");
    return res.data.data;
  },

  /** A train by number and day, boarded at a catalogue station or a position. */
  async lookup(query: RailLookupQuery): Promise<RailLookupAnswer> {
    const res = await api.get<Envelope<RailLookupAnswer>>("/rail/lookup", { params: query });
    return res.data.data;
  },
};

export interface RailLookupQuery {
  trainNumber: string;
  category?: string;
  /** YYYY-MM-DD on the boarding station's clock. */
  date: string;
  fromStationId?: number;
  fromLat?: number;
  fromLon?: number;
}

import { api } from "./client";
import type {
  RailJourney,
  RailJourneyDetail,
  RailJourneyInput,
  RailLookupAnswer,
  RailLookupProviders,
  RailStationHit,
  RailStats,
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

  /**
   * Every journey matching `query`, a page of 500 (the endpoint's cap) at a
   * time — for the statistics overview and the export, which need the whole set.
   */
  async listAll(query: Omit<RailListQuery, "limit" | "offset"> = {}): Promise<RailJourney[]> {
    const PAGE = 500;
    const rides: RailJourney[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await railApi.list({ ...query, limit: PAGE, offset });
      rides.push(...page.journeys);
      if (page.journeys.length < PAGE || rides.length >= page.total) return rides;
    }
  },

  /** One journey with its booking's legs. */
  async get(id: string): Promise<RailJourneyDetail> {
    const res = await api.get<Envelope<RailJourneyDetail>>(`/rail/${encodeURIComponent(id)}`);
    return res.data.data;
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

  /** The statistics over completed rides; `year` is the year a ride left in. */
  async stats(year: number | null = null): Promise<RailStats> {
    const res = await api.get<Envelope<RailStats>>("/rail/stats", {
      params: year === null ? {} : { year },
    });
    return res.data.data;
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

  /** What converting a roadtrip by rail would write — nothing is written. */
  async previewRoadtripConversion(routeId: string): Promise<RoadtripConversionPreview> {
    const res = await api.get<Envelope<RoadtripConversionPreview>>(
      `/rail/roadtrip-conversion/${encodeURIComponent(routeId)}`
    );
    return res.data.data;
  },

  /**
   * One ride per leg; a ride an earlier run wrote is not written again.
   * `removeSection` only after the user confirmed it.
   */
  async convertRoadtrip(
    routeId: string,
    removeSection: boolean
  ): Promise<RoadtripConversionResult> {
    const res = await api.post<Envelope<RoadtripConversionResult>>(
      `/rail/roadtrip-conversion/${encodeURIComponent(routeId)}`,
      { removeSection }
    );
    return res.data.data;
  },
};

export type RoadtripConversionSkipReason = "notRail" | "stopMissing" | "noPosition" | "noDate";

export interface RoadtripConversionPreview {
  routeId: string;
  name: string;
  rides: Array<{
    legId: string;
    departureStationName: string;
    arrivalStationName: string;
    /** YYYY-MM-DD; the ride leaves at noon of it on the station's clock. */
    departureDay: string;
    distanceKm: number;
    /** The ride an earlier conversion already wrote. */
    journeyId: string | null;
  }>;
  skipped: Array<{
    legId: string;
    fromStopId: string;
    toStopId: string;
    reason: RoadtripConversionSkipReason;
  }>;
  canRemoveSection: boolean;
}

export interface RoadtripConversionResult {
  created: number;
  alreadyConverted: number;
  journeyIds: string[];
  skipped: RoadtripConversionPreview["skipped"];
  sectionRemoved: boolean;
}

export interface RailLookupQuery {
  trainNumber: string;
  category?: string;
  /** YYYY-MM-DD on the boarding station's clock. */
  date: string;
  fromStationId?: number;
  fromLat?: number;
  fromLon?: number;
}

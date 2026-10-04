import { api } from "./client";
import { API_TIMEOUTS } from "../../config/constants";
import type {
  RailConnection,
  RailConnectionDetail,
  RailJourney,
  RailEntrySuggestions,
  RailJourneyDetail,
  RailJourneyInput,
  RailLookupAnswer,
  RailLookupProviders,
  RailSaveResult,
  RailGeometryReport,
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

type SaveEnvelope = Envelope<RailJourney> & { meta?: { geometry?: RailGeometryReport } };

/** The summary strip's figures over the whole FILTERED list, counted by the server. */
export interface RailListSummary {
  journeys: number;
  operators: number;
  withoutOperator: number;
  stations: number;
}

export interface RailPage {
  journeys: RailJourney[];
  total: number;
  summary: RailListSummary;
}

export interface RailListQuery {
  q?: string;
  year?: number;
  /** A rail loyalty card: only the rides it counts. */
  membershipId?: string;
  status?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface RailConnectionPage {
  connections: RailConnection[];
  total: number;
  summary: RailListSummary;
}

/** The connection list orders by first departure only, and takes no card filter. */
export type RailConnectionQuery = Omit<RailListQuery, "sort" | "membershipId">;

export const railApi = {
  async list(query: RailListQuery = {}): Promise<RailPage> {
    const res = await api.get<
      Envelope<RailJourney[]> & { meta: { total: number; summary: RailListSummary } }
    >("/rail", {
      params: query,
    });
    return { journeys: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
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

  /**
   * One page of the logbook as connections (forgejo#187): a ride with changes
   * is one entry. `total` counts connections — what a "load more" pages over.
   */
  async listConnections(query: RailConnectionQuery = {}): Promise<RailConnectionPage> {
    const res = await api.get<
      Envelope<RailConnection[]> & { meta: { total: number; summary: RailListSummary } }
    >("/rail/connections", { params: query });
    return {
      connections: res.data.data,
      total: res.data.meta.total,
      summary: res.data.meta.summary,
    };
  },

  /** The whole ride a leg belongs to — itself alone when it has no change. */
  async getConnection(legId: string): Promise<RailConnectionDetail> {
    const res = await api.get<Envelope<RailConnectionDetail>>(
      `/rail/connections/${encodeURIComponent(legId)}`
    );
    return res.data.data;
  },

  /** One journey with its booking's legs. */
  async get(id: string): Promise<RailJourneyDetail> {
    const res = await api.get<Envelope<RailJourneyDetail>>(`/rail/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  /** The saved row, and what the save did to its line (`meta.geometry`). */
  async create(input: RailJourneyInput): Promise<RailSaveResult> {
    const res = await api.post<SaveEnvelope>("/rail", input);
    return { journey: res.data.data, geometry: res.data.meta?.geometry ?? null };
  },

  async update(id: string, input: Partial<RailJourneyInput>): Promise<RailSaveResult> {
    const res = await api.patch<SaveEnvelope>(`/rail/${id}`, input);
    return { journey: res.data.data, geometry: res.data.meta?.geometry ?? null };
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/rail/${id}`);
  },

  /**
   * The statistics over completed rides; `year` is the year a ride left in.
   * `until` ("MM-DD") cuts that year at the day a same-span comparison ends.
   */
  async stats(year: number | null = null, until: string | null = null): Promise<RailStats> {
    const res = await api.get<Envelope<RailStats>>("/rail/stats", {
      params: year === null ? {} : until === null ? { year } : { year, until },
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

  /** Chips for the rail form from the user's own rides; nothing is written. */
  async entrySuggestions(query: RailEntrySuggestionsQuery): Promise<RailEntrySuggestions> {
    const res = await api.get<Envelope<RailEntrySuggestions>>("/rail/entry-suggestions", {
      params: query,
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
    const res = await api.get<Envelope<RailLookupAnswer>>("/rail/lookup", {
      params: query,
      timeout: API_TIMEOUTS.RAIL_LOOKUP,
    });
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
  /** Why the section must stay: a leg that is no ride, or costs with no trip to take them. */
  removeBlockedBy?: "legs" | "costs" | null;
}

export interface RoadtripConversionResult {
  created: number;
  alreadyConverted: number;
  journeyIds: string[];
  skipped: RoadtripConversionPreview["skipped"];
  sectionRemoved: boolean;
}

export interface RailEntrySuggestionsQuery {
  depStationId?: number;
  arrStationId?: number;
  depName?: string;
  arrName?: string;
  operator?: string;
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

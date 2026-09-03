import type {
  Flight,
  FlightFilters,
  FlightInput,
  GeoJSONFeatureCollection,
  UserAchievement,
} from "../../types";

import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";

/** The soonest upcoming flight for the dashboard block, enriched with the
 *  city/country of each end. `flight` is null when nothing lies ahead. */
export interface NextFlightEnd {
  city: string | null;
  country: string | null;
}
export interface NextFlight {
  id: string;
  airline: string | null;
  airlineIata: string | null;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
  tripId: string | null;
  departure: NextFlightEnd;
  arrival: NextFlightEnd;
}

// Flights API
export const flightsApi = {
  getNext: async (): Promise<NextFlight | null> => {
    const { data } = await api.get<{ flight: NextFlight | null }>("/flights/next");
    return data.flight;
  },

  getAll: async (
    filters?: FlightFilters
  ): Promise<{
    flights: Flight[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const { data } = await api.get<{
      flights: Flight[];
      total: number;
      limit: number;
      offset: number;
    }>("/flights", { params: filters });
    return data;
  },

  getGeoJSON: async (filters?: FlightFilters): Promise<GeoJSONFeatureCollection> => {
    const { data } = await api.get<GeoJSONFeatureCollection>("/flights/geo", {
      params: filters,
    });
    return data;
  },

  /**
   * Load the COMPLETE GeoJSON feature collection by paginating through the
   * backend `/geo` endpoint (which caps each page at 500 and defaults to just
   * 100). The dashboard map needs EVERY flight, not only the most recent page,
   * otherwise older flights — e.g. a one-off trip from years ago — silently
   * vanish from every map view. Mirrors the pagination the V1 dashboard did
   * before the multi-domain refactor dropped it.
   */
  getAllGeoJSON: async (filters?: FlightFilters): Promise<GeoJSONFeatureCollection> => {
    const PAGE = 500;
    const MAX_PAGES = 100; // safety bound (up to 50k flights)
    const features: GeoJSONFeatureCollection["features"] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data } = await api.get<GeoJSONFeatureCollection>("/flights/geo", {
        params: { ...filters, limit: PAGE, offset: page * PAGE },
      });
      const batch = data.features ?? [];
      features.push(...batch);
      if (batch.length < PAGE) break;
    }
    return { type: "FeatureCollection", features };
  },

  getById: async (id: string): Promise<Flight> => {
    const { data } = await api.get<Flight>(`/flights/${id}`);
    return data;
  },

  create: async (
    flight: FlightInput,
    opts: { force?: boolean; merge?: boolean } = {}
  ): Promise<Flight> => {
    const params = new URLSearchParams();
    if (opts.force) params.set("force", "true");
    else if (opts.merge) params.set("merge", "true");
    const qs = params.toString();
    // POST /flights wraps the created (or merged) flight as
    // { flight, mergedFields?, newAchievements? } — NOT a bare Flight.
    // Flatten to the Flight (so callers get a real `id`), preserving the
    // extras some callers read (the merged-fields toast).
    const { data } = await api.post<{
      flight: Flight;
      mergedFields?: string[];
      newAchievements?: unknown[];
    }>(`/flights${qs ? `?${qs}` : ""}`, flight);
    return {
      ...data.flight,
      mergedFields: data.mergedFields,
      newAchievements: data.newAchievements,
    } as Flight;
  },

  // Updates accept the canonical-UTC submit contract — partial FlightInput
  // (with departureLocal + depTimezone pairs). Partial<Flight> is rejected
  // server-side because departureTime/arrivalTime are no longer recognized.
  update: async (id: string, flight: Partial<FlightInput>): Promise<Flight> => {
    const { data } = await api.put<Flight>(`/flights/${id}`, flight);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/flights/${id}`);
  },

  // `batchId` rides in the query rather than the body: the body is a bare
  // array and has been since the first API client shipped.
  createBatch: async (
    flights: FlightInput[],
    batchId?: string | null
  ): Promise<{
    flights: Flight[];
    count: number;
    skipped?: number;
    newAchievements?: UserAchievement[];
  }> => {
    const qs = batchId ? `?batchId=${encodeURIComponent(batchId)}` : "";
    const { data } = await api.post<{
      flights: Flight[];
      count: number;
      skipped?: number;
      newAchievements?: UserAchievement[];
    }>(`/flights/batch${qs}`, flights);
    return data;
  },

  // Bulk historical refresh — pre-flight count of refreshable flights.
  // Returns 403 with `error: 'DEMO_ACCOUNT_FORBIDDEN'` for seeded demo
  // accounts so the UI can disable the button with an explanatory tooltip.
  bulkRefreshPreview: async (): Promise<{
    remaining: number;
    hasHistoricalProvider: boolean;
    aerodataboxQuota: AerodataboxQuota | null;
  }> => {
    const { data } = await api.get<{
      remaining: number;
      hasHistoricalProvider: boolean;
      aerodataboxQuota: AerodataboxQuota | null;
    }>("/flights/refresh-historical-bulk/preview");
    return data;
  },

  // Bulk refresh loops sequentially through up to 25 flights, each calling
  // an external historical provider (AeroDataBox / Aviationstack). With the
  // default 10s timeout the request reliably aborts client-side while the
  // backend keeps running — confusing the UI and wasting RapidAPI quota on
  // results that never reach the user. PARSER timeout (180s) matches the
  // worst-case 25 × 5s upper bound with headroom.
  bulkRefreshRun: async (): Promise<BulkRefreshSummary> => {
    const { data } = await api.post<BulkRefreshSummary>(
      "/flights/refresh-historical-bulk",
      undefined,
      { timeout: API_TIMEOUTS.PARSER }
    );
    return data;
  },
};

export interface AerodataboxQuota {
  limit: number | null;
  remaining: number | null;
  observedAt: string;
}

export interface BulkRefreshSummary {
  scanned: number;
  updated: number;
  noData: number;
  /**
   * The provider answered and there was nothing left to fill. Kept apart from
   * `noData`, which means the opposite — that the provider has nothing on the
   * leg at all. One number for both is what made "refreshing changed nothing"
   * unreadable: it was true of the fields being watched and false of the run.
   */
  alreadyComplete: number;
  failed: number;
  remaining: number;
  results: Array<{
    flightId: string;
    flightNumber: string;
    outcome: "updated" | "no_data" | "already_complete" | "failed";
    fieldsUpdated?: string[];
    /** Why nothing was written, in the provider's vocabulary. */
    reason?: string;
    error?: string;
  }>;
  aerodataboxQuota?: AerodataboxQuota | null;
}

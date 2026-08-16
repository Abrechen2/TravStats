import { api } from "./client";
import type { Cruise, CruiseInput, Port, Ship } from "../../types";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface CruiseListQuery {
  status?: string | string[];
  cruiseLine?: string | string[];
  year?: number;
  region?: string;
  tripId?: string;
  sort?: "date" | "ship" | "line" | "ports" | "status";
  limit?: number;
  offset?: number;
}

/**
 * GeoJSON feature returned by `GET /api/v1/cruises/:id/geometry`.
 * Each feature's coordinates are the 3-8 schematic waypoints the
 * coarse router produced — the frontend runs a Catmull-Rom spline
 * through them to render a smooth curve. `routed: false` means the
 * ports were on disconnected seas; those get a 2-point direct chord
 * which the spline renders as a straight line.
 */
export interface CruiseRouteFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: {
    fromPortId: number;
    toPortId: number;
    routed: boolean;
    protectedPrefixCount?: number;
    protectedSuffixCount?: number;
    method?: "short_hop" | "maritime_graph" | "coarse_a_star" | "direct" | "manual_polyline";
  };
}

export interface CruiseRouteFeatureCollection {
  type: "FeatureCollection";
  features: CruiseRouteFeature[];
}

export const cruiseApi = {
  list: async (q: CruiseListQuery = {}): Promise<Cruise[]> => {
    const { data } = await api.get<Envelope<Cruise[]>>("/cruises", { params: q });
    return data.data;
  },
  get: async (id: string): Promise<Cruise> => {
    const { data } = await api.get<Envelope<Cruise>>(`/cruises/${id}`);
    return data.data;
  },
  getGeometry: async (id: string): Promise<CruiseRouteFeatureCollection> => {
    const { data } = await api.get<Envelope<CruiseRouteFeatureCollection>>(
      `/cruises/${id}/geometry`
    );
    return data.data;
  },
  /**
   * Batch geometry fetch for the dashboard. Replaces N sequential GETs with
   * a single POST. Cruises the user does not own are silently omitted from
   * the result. Server caches per-port-pair routes in memory, so repeated
   * calls (and overlapping legs across cruises) are essentially free.
   */
  getGeometryBatch: async (ids: string[]): Promise<Map<string, CruiseRouteFeatureCollection>> => {
    if (ids.length === 0) return new Map();
    const { data } = await api.post<Envelope<Record<string, CruiseRouteFeatureCollection>>>(
      "/cruises/geometry/batch",
      { ids }
    );
    return new Map(Object.entries(data.data));
  },
  create: async (input: CruiseInput): Promise<Cruise> => {
    const { data } = await api.post<Envelope<Cruise>>("/cruises", input);
    return data.data;
  },
  update: async (id: string, input: CruiseInput): Promise<Cruise> => {
    const { data } = await api.patch<Envelope<Cruise>>(`/cruises/${id}`, input);
    return data.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/cruises/${id}`);
  },
};

/**
 * A port candidate resolved from the external geocoder (not yet in the DB).
 * Has no `id`/`unlocode` — selecting one POSTs it to /ports to persist it.
 */
export interface GeocodedPort {
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  source: "geocoder";
}

export const portsApi = {
  search: async (q: string, region?: string): Promise<Port[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (region) params.region = region;
    const { data } = await api.get<Envelope<Port[]>>("/ports", { params });
    return data.data;
  },
  /** Like search, but keeps the server-side total for truncation hints. */
  list: async (q: string): Promise<{ items: Port[]; total: number }> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Port[]> & { total?: number }>("/ports", { params });
    return { items: data.data, total: data.total ?? data.data.length };
  },
  /**
   * External geocoder fallback for ports missing from the local catalog.
   * Returns [] on error — callers treat it as a soft enhancement.
   */
  geocode: async (q: string): Promise<GeocodedPort[]> => {
    const { data } = await api.get<Envelope<GeocodedPort[]>>("/ports/geocode", {
      params: { q },
    });
    return data.data;
  },
  create: async (input: {
    name: string;
    city?: string;
    country?: string;
    lat: number;
    lon: number;
    unlocode?: string;
    region?: string;
  }): Promise<Port> => {
    const { data } = await api.post<Envelope<Port>>("/ports", input);
    return data.data;
  },
};

export const shipsApi = {
  /** Like search, but keeps the server-side total for truncation hints. */
  list: async (q: string): Promise<{ items: Ship[]; total: number }> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<Envelope<Ship[]> & { total?: number }>("/ships", { params });
    return { items: data.data, total: data.total ?? data.data.length };
  },
  search: async (q: string, cruiseLine?: string): Promise<Ship[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (cruiseLine) params.cruiseLine = cruiseLine;
    const { data } = await api.get<Envelope<Ship[]>>("/ships", { params });
    return data.data;
  },
  create: async (input: {
    name: string;
    cruiseLine: string;
    imo?: string;
    yearBuilt?: number;
    grossTonnage?: number;
    capacity?: number;
  }): Promise<Ship> => {
    const { data } = await api.post<Envelope<Ship>>("/ships", input);
    return data.data;
  },
};

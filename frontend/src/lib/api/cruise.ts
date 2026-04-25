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

export const portsApi = {
  search: async (q: string, region?: string): Promise<Port[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    if (region) params.region = region;
    const { data } = await api.get<Envelope<Port[]>>("/ports", { params });
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

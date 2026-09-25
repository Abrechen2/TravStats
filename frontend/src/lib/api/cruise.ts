import { api } from "./client";
import { logger } from "../logger";
import type { Cruise, CruiseInput, Port, Ship } from "../../types";
import type { CruiseSortField } from "../../shared/cruiseListOrder";

/** The server's own maximum per request (`cruiseQuerySchema`). */
const CRUISE_PAGE_SIZE = 500;
/** Backstop against an endless loop if `meta.total` ever disagrees with the
 *  rows actually returned. 20 000 sailings is far past any real account. */
const MAX_CRUISE_PAGES = 40;

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface PagedEnvelope<T> extends Envelope<T> {
  meta: { total: number; limit: number; offset: number };
}

/** One option in a cruise filter dropdown, with how many rows carry it. */
export interface CruiseFacetOption<T extends string | number> {
  value: T;
  count: number;
}

/** `GET /cruises/facets` — the lists and figures drawn around the table. */
export interface CruiseFacets {
  years: CruiseFacetOption<number>[];
  lines: CruiseFacetOption<string>[];
  summary: { cruises: number; portCalls: number; seaDays: number; lines: number };
}

export interface CruiseListQuery {
  status?: string | string[];
  /** Exact match on the `cruiseLine` COLUMN. For the dropdown, see `shipLine`. */
  cruiseLine?: string | string[];
  /** The line a cruise belongs to — its own, or its ship's when it has none. */
  shipLine?: string;
  /** Free text over ship, line, route name and the ports it called at. */
  q?: string;
  year?: number;
  month?: number;
  region?: string;
  tripId?: string;
  sort?: CruiseSortField;
  order?: "asc" | "desc";
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

/**
 * Identifies one leg by its two endpoints — the same key the server stores
 * under. Deliberately not the leg's position: inserting a port would shift
 * every stored line onto the wrong leg (see the spec, §4.3).
 */
export interface RouteOverrideKey {
  fromKind: "port";
  fromRef: string;
  toKind: "port";
  toRef: string;
}

export const cruiseApi = {
  /**
   * EVERY cruise matching the query — all of them, walked page by page.
   *
   * This used to be a single request with no `limit`, which the server
   * answers with its cap of 500 and, until 2026-09-20, with no `meta` to
   * notice it by. From 501 cruises on the dashboard map drew a subset, the
   * spreadsheet export wrote a subset and the statistics counted a subset,
   * and nothing anywhere said so. It is the same defect `listLodgings` was
   * written for, and the same answer: paging HERE rather than in each caller,
   * because the map, the stats, the export and the domain summary all go
   * through this one function.
   *
   * The LIST PAGE does not — it wants one page, and asks for it through
   * `listPage` below.
   */
  list: async (q: CruiseListQuery = {}): Promise<Cruise[]> => {
    const items: Cruise[] = [];
    for (let page = 0; page < MAX_CRUISE_PAGES; page += 1) {
      const { data } = await api.get<PagedEnvelope<Cruise[]>>("/cruises", {
        params: { ...q, limit: CRUISE_PAGE_SIZE, offset: page * CRUISE_PAGE_SIZE },
      });
      items.push(...data.data);
      // An empty page ends the walk even if `meta` is missing or wrong —
      // without it a stale `total` would spin this to its cap on every load.
      if (data.data.length === 0) return items;
      if (data.meta === undefined || items.length >= data.meta.total) return items;
    }
    logger.warn("cruiseApi.list: stopped at the page cap — some cruises were not fetched");
    return items;
  },

  /**
   * ONE page, with the size of the filtered set beside it.
   *
   * `total` is what the pager counts with and what the "N treffen zu" label
   * reports — the filtered set, not the page and not the account.
   */
  listPage: async (q: CruiseListQuery = {}): Promise<{ items: Cruise[]; total: number }> => {
    const { data } = await api.get<PagedEnvelope<Cruise[]>>("/cruises", { params: q });
    return { items: data.data, total: data.meta?.total ?? data.data.length };
  },

  /**
   * The year and line option lists, and the summary figures, for a filter set
   * — counted by the database.
   *
   * The logbook used to derive all of this from the complete row set in the
   * browser, which is why it held every sailing before it could draw a page.
   */
  facets: async (q: CruiseListQuery = {}): Promise<CruiseFacets> => {
    const { data } = await api.get<Envelope<CruiseFacets>>("/cruises/facets", { params: q });
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
  /** Store this leg's hand-corrected line. Replaces any previous one. */
  saveRouteOverride: async (
    cruiseId: string,
    key: RouteOverrideKey,
    waypoints: Array<[number, number]>
  ): Promise<void> => {
    await api.put(`/cruises/${cruiseId}/route-override`, { ...key, waypoints });
  },
  /**
   * Back to the router's line. The key travels as query parameters because
   * that is where the server reads it on DELETE.
   */
  clearRouteOverride: async (cruiseId: string, key: RouteOverrideKey): Promise<void> => {
    await api.delete(`/cruises/${cruiseId}/route-override`, { params: { ...key } });
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
  /** Cruise-line suggestions: the user's own lines first, then the catalogue's. */
  cruiseLines: async (q: string): Promise<string[]> => {
    const { data } = await api.get<Envelope<string[]>>("/ships/cruise-lines", { params: { q } });
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

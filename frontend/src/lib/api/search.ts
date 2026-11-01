import { api } from "./client";

/** Mirrors `backend/src/services/search/types.ts`; change both. */
export type SearchDomain =
  | "flight"
  | "cruise"
  | "lodging"
  | "poi"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "roadtrip"
  | "tour"
  | "trip";

export interface SearchHit {
  domain: SearchDomain;
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  /** UTC instant the entry starts; null for a place or a list. */
  date: string | null;
  /** Web route that opens the entry. */
  path: string;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  /** Domains holding more matches than were returned. */
  more: SearchDomain[];
  /** Domains whose search failed: the answer is incomplete for them. */
  failed: SearchDomain[];
  capped: boolean;
}

export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_TOTAL_CAP = 60;

export const searchApi = {
  /** `GET /search` (forgejo#403). */
  search: async (
    params: { q: string; limit?: number; domains?: SearchDomain[] },
    signal?: AbortSignal
  ): Promise<SearchResult> => {
    const { data } = await api.get<{ success: true; data: SearchResult }>("/search", {
      params: {
        q: params.q,
        limit: params.limit,
        domains: params.domains?.length ? params.domains.join(",") : undefined,
      },
      signal,
    });
    return data.data;
  },
};

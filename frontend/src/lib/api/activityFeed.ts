import { api } from "./client";
import type { LocalDateValue } from "../../shared/time/wire";

/** Mirrors `backend/src/services/activityFeed/types.ts`; change both. */
export type ActivityFeedDomain =
  | "flight"
  | "cruise"
  | "lodging"
  | "poi"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "roadtrip"
  | "tour";

export type FeedBbox = [west: number, south: number, east: number, north: number];

export interface ActivityFeedItem {
  /** `domain:id`, unique across domains. */
  key: string;
  domain: ActivityFeedDomain;
  id: string;
  /** What a click selects: the lodging of a stay, the place of a visit. */
  subjectId: string;
  title: string;
  subtitle: string | null;
  place: string | null;
  /** The entry's own local day; null when it has none. */
  date: LocalDateValue | null;
  sortAt: string | null;
  planned: boolean;
  /** One place to zoom to. */
  point: { lat: number; lon: number } | null;
  /** A route's extent to fit. */
  bbox: FeedBbox | null;
  path: string;
}

export interface ActivityFeedPage {
  items: ActivityFeedItem[];
  nextCursor: string | null;
  /** Domains whose reader failed: for those the page is incomplete, not empty. */
  failed: ActivityFeedDomain[];
  domains: ActivityFeedDomain[];
}

export const ACTIVITY_FEED_PAGE_SIZE = 50;

export const activityFeedApi = {
  /** `GET /activity/feed`. */
  page: async (
    params: { cursor?: string | null; limit?: number },
    signal?: AbortSignal
  ): Promise<ActivityFeedPage> => {
    const { data } = await api.get<{ success: true; data: ActivityFeedPage }>("/activity/feed", {
      params: {
        cursor: params.cursor ?? undefined,
        limit: params.limit ?? ACTIVITY_FEED_PAGE_SIZE,
      },
      signal,
    });
    return data.data;
  },
};

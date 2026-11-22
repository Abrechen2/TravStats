import { loadVisibleDomains } from "../domainVisibility";
import {
  roadtripSource,
  tourSource,
  railSource,
  busSource,
  ferrySource,
  rentalSource,
} from "./groundSources";
import { cruiseSource, flightSource, lodgingSource, placeSource, type FeedSource } from "./sources";
import {
  DOMAIN_RANK,
  FEED_DOMAINS,
  decodeCursor,
  encodeCursor,
  type FeedDomain,
  type FeedItem,
} from "./types";

export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 200;

const SOURCES: Record<FeedDomain, FeedSource> = {
  flight: flightSource,
  cruise: cruiseSource,
  lodging: lodgingSource,
  poi: placeSource,
  rail: railSource,
  bus: busSource,
  ferry: ferrySource,
  rental: rentalSource,
  roadtrip: roadtripSource,
  tour: tourSource,
};

export class InvalidFeedCursorError extends Error {
  constructor() {
    super("Invalid activity feed cursor");
  }
}

export interface ActivityFeedPage {
  items: FeedItem[];
  /** Pass back as `cursor` for the next page; null when this was the last. */
  nextCursor: string | null;
  /** Domains whose reader failed: for those the page is incomplete, not empty. */
  failed: FeedDomain[];
  /** The domains this answer covers — what the account may see. */
  domains: FeedDomain[];
}

/** Newest first; undated last; at one instant the registry order. Stable, so a domain's own (id desc) order survives. */
function byRecency(a: FeedItem, b: FeedItem): number {
  if (a.sortAt !== b.sortAt) {
    if (a.sortAt === null) return 1;
    if (b.sortAt === null) return -1;
    return a.sortAt < b.sortAt ? 1 : -1;
  }
  return DOMAIN_RANK[a.domain] - DOMAIN_RANK[b.domain];
}

/**
 * One page of the activity list across every domain the account can see.
 *
 * Every reader is asked for `limit + 1` rows after the cursor, so the merged
 * head of `limit` rows is exact and the extra row says whether a further page
 * exists. A reader that throws is named in `failed` instead of silently
 * thinning the page — and the cursor still advances past what WAS read, so
 * the client can show the gap rather than loop on it.
 */
export async function loadActivityFeed(
  userId: string,
  opts: { cursor?: string; limit?: number; domains?: readonly FeedDomain[] }
): Promise<ActivityFeedPage> {
  const limit = Math.min(Math.max(opts.limit ?? FEED_DEFAULT_LIMIT, 1), FEED_MAX_LIMIT);
  const cursor = opts.cursor === undefined ? null : decodeCursor(opts.cursor);
  if (opts.cursor !== undefined && cursor === null) throw new InvalidFeedCursorError();

  const visible = new Set(await loadVisibleDomains(userId));
  const wanted = new Set(opts.domains ?? FEED_DOMAINS);
  const domains = FEED_DOMAINS.filter((d) => visible.has(d) && wanted.has(d));

  const failed: FeedDomain[] = [];
  const settled = await Promise.all(
    domains.map(async (d) => {
      try {
        return await SOURCES[d](userId, cursor, limit + 1);
      } catch {
        failed.push(d);
        return [] as FeedItem[];
      }
    })
  );
  const merged = settled.flat().sort(byRecency);
  const items = merged.slice(0, limit);
  const last = items[items.length - 1];
  const more = merged.length > limit && last !== undefined;
  return {
    items,
    nextCursor: more
      ? encodeCursor({
          t: last.sortAt === null ? null : Date.parse(last.sortAt),
          r: DOMAIN_RANK[last.domain],
          i: last.id,
        })
      : null,
    failed,
    domains,
  };
}

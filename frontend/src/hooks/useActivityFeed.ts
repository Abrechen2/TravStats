import { useCallback, useEffect, useRef, useState } from "react";
import {
  activityFeedApi,
  type ActivityFeedDomain,
  type ActivityFeedItem,
} from "../lib/api/activityFeed";
import { logger } from "../lib/logger";

export interface ActivityFeedState {
  items: ActivityFeedItem[];
  /** The first page is in flight. */
  loading: boolean;
  /** A further page is in flight. */
  loadingMore: boolean;
  /** A request failed. The items already loaded stay; `retry` repeats the failed one. */
  error: boolean;
  /** Domains whose reader failed on some page: the list is incomplete for them. */
  failed: ActivityFeedDomain[];
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

/**
 * The dashboard activity list, a page at a time from the server's merged feed
 * (`GET /activity/feed`) instead of every domain's full list. `enabled` gates
 * the fetch itself, so a closed panel costs no request; `reloadKey` starts the
 * list over (an entry was saved).
 */
export function useActivityFeed(
  enabled: boolean,
  reloadKey = 0,
  /** Narrow to these domains (a single-domain tab); omitted = every visible domain. */
  domains?: readonly ActivityFeedDomain[]
): ActivityFeedState {
  const domainsKey = domains?.join(",") ?? "";
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [failed, setFailed] = useState<ActivityFeedDomain[]>([]);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (after: string | null, first: boolean): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = generation.current;
      if (first) setLoading(true);
      else setLoadingMore(true);
      setError(false);
      try {
        const page = await activityFeedApi.page({
          cursor: after,
          domains: domainsKey ? (domainsKey.split(",") as ActivityFeedDomain[]) : undefined,
        });
        if (mine !== generation.current) return;
        setItems((prev) => (first ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setFailed((prev) => [...new Set([...(first ? [] : prev), ...page.failed])]);
      } catch (err) {
        if (mine !== generation.current) return;
        logger.warn("activity feed page failed", err);
        setError(true);
      } finally {
        if (mine === generation.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        inFlight.current = false;
      }
    },
    [domainsKey]
  );

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setFailed([]);
    setError(false);
    if (!enabled) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    void fetchPage(null, true);
    return () => {
      generation.current += 1;
    };
  }, [enabled, reloadKey, fetchPage]);

  const loadMore = useCallback((): void => {
    if (!hasMore || cursor === null) return;
    void fetchPage(cursor, false);
  }, [hasMore, cursor, fetchPage]);

  const retry = useCallback((): void => {
    // A failed first page has no cursor yet and starts over; a failed later page repeats itself.
    void fetchPage(cursor, cursor === null);
  }, [cursor, fetchPage]);

  return { items, loading, loadingMore, error, failed, hasMore, loadMore, retry };
}

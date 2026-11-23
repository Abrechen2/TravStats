import { useCallback, useEffect, useState } from "react";
import { logger } from "../../lib/logger";
import { positiveIntParam, useQueryState } from "../../hooks/useQueryState";

/**
 * Pagination for a list the SERVER pages.
 *
 * Sibling of `usePagination`, and deliberately not a replacement for it: that
 * hook slices rows the page already holds, which is still right for the
 * cruise and places lists. This one holds only the numbers — page, size and
 * the `offset` to ask for — and never sees a row.
 *
 * The distinction is the whole point of the change it belongs to. The flights
 * logbook could not page on the server while its filter bar, its summary
 * strip and its sort all worked over the complete set, so it fetched every
 * flight the account owns in a `limit=500` loop and called slicing the tail
 * "pagination" (measured 2026-09-20). Counting moved to `/flights/facets`,
 * filtering and sorting to `GET /flights`, and what is left here is
 * arithmetic. The lodging list followed the same day, through
 * `/lodging/facets` and a `GET /lodging` that orders by the values derived
 * from the stays.
 *
 * The page-size preference shares `usePagination`'s storage key shape and its
 * try/catch discipline, so a reader who set 25 rows on one logbook keeps it
 * on this one.
 */

const STORAGE_PREFIX = "travstats:table-page-size:";
const DEFAULT_PAGE_SIZE = 50;

/**
 * The server's own cap (`flightQuerySchema`). A stored "all" — set before
 * this list paged on the server, or on another logbook that still offers it —
 * cannot be honoured here, because "all" over a network is a promise about a
 * row count nobody has checked. It falls back to the default rather than
 * silently showing the first 500 of 900 under a label that says "Alle".
 */
const MAX_SERVER_PAGE_SIZE = 500;

function readPageSize(tableKey: string): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableKey);
    const parsed = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_SERVER_PAGE_SIZE);
  } catch (err) {
    logger.warn("useServerPagination: unreadable preference, starting fresh", err);
    return DEFAULT_PAGE_SIZE;
  }
}

export interface ServerPagination {
  page: number;
  pageCount: number;
  pageSize: number;
  /** What to send as `limit`. */
  limit: number;
  /** What to send as `offset`. */
  offset: number;
  total: number;
  setPage: (page: number) => void;
  setPageSize: (size: number | "all") => void;
}

export function useServerPagination(
  /** `total` from the last response — the size of the FILTERED set. */
  total: number,
  tableKey: string,
  /**
   * A string that changes whenever the filters do.
   *
   * Page 7 of "all flights" is not page 7 of "flights with Lufthansa", and
   * staying on it shows an empty table under a filled-in filter bar — the
   * same trap `usePagination` watches `rows.length` for. Watching `total`
   * instead would be wrong here: a filter that happens not to change the
   * count would leave the reader stranded, and `total` also arrives one
   * render LATE, so page 1 would be requested at the old offset first.
   */
  filterSignature: string,
  /**
   * The query parameter the page lives in. In the URL, so Back from a detail
   * page and a reload land on the page the reader left (owner report
   * 2026-11-23), not on page 1.
   */
  pageParam = "page"
): ServerPagination {
  const [pageSize, setPageSizeState] = useState<number>(() => readPageSize(tableKey));
  const [urlPage, setUrlPage] = useQueryState(pageParam, 1, positiveIntParam);
  const [lastSignature, setLastSignature] = useState<string>(filterSignature);

  // New filters mean page 1 IN THE SAME RENDER that brings them: the caller's
  // fetch effect reads `offset` from this render, so a page 7 that the new set
  // no longer has is never requested. The URL catches up in an effect (a
  // navigation cannot happen during render), and that second render asks for
  // the same offset, so it costs no second request.
  const signatureChanged = lastSignature !== filterSignature;
  useEffect(() => {
    if (!signatureChanged) return;
    setLastSignature(filterSignature);
    setUrlPage(1);
  }, [signatureChanged, filterSignature, setUrlPage]);
  const page = signatureChanged ? 1 : urlPage;
  const setPage = setUrlPage;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Not clamped while `total` is still 0: before the first answer arrives the
  // page count is unknown, and clamping then would throw a restored page 2
  // back to page 1 before the list ever asked for it.
  const clampedPage = total > 0 ? Math.min(Math.max(page, 1), pageCount) : Math.max(page, 1);

  const setPageSize = useCallback(
    (size: number | "all"): void => {
      const next = size === "all" ? MAX_SERVER_PAGE_SIZE : Math.min(size, MAX_SERVER_PAGE_SIZE);
      setPageSizeState(next);
      // A different page size means different page boundaries, so page 3 is
      // not the same rows it was a moment ago.
      setPage(1);
      try {
        localStorage.setItem(STORAGE_PREFIX + tableKey, String(next));
      } catch (err) {
        // Storage full or disabled: pagination still works, it just forgets.
        logger.warn("useServerPagination: could not persist the page size", err);
      }
    },
    [tableKey, setPage]
  );

  return {
    page: clampedPage,
    pageCount,
    pageSize,
    limit: pageSize,
    offset: (clampedPage - 1) * pageSize,
    total,
    setPage,
    setPageSize,
  };
}

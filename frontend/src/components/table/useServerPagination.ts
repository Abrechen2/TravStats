import { useCallback, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * Pagination for a list the SERVER pages.
 *
 * Sibling of `usePagination`, and deliberately not a replacement for it: that
 * hook slices rows the page already holds, which is still right for the
 * lodging and cruise lists. This one holds only the numbers — page, size and
 * the `offset` to ask for — and never sees a row.
 *
 * The distinction is the whole point of the change it belongs to. The flights
 * logbook could not page on the server while its filter bar, its summary
 * strip and its sort all worked over the complete set, so it fetched every
 * flight the account owns in a `limit=500` loop and called slicing the tail
 * "pagination" (measured 2026-09-20). Counting moved to `/flights/facets`,
 * filtering and sorting to `GET /flights`, and what is left here is
 * arithmetic.
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
  filterSignature: string
): ServerPagination {
  const [pageSize, setPageSizeState] = useState<number>(() => readPageSize(tableKey));
  const [page, setPage] = useState<number>(1);
  const [lastSignature, setLastSignature] = useState<string>(filterSignature);

  // Adjusted DURING the render that brings the new filters, not in an effect.
  // An effect runs after the caller's fetch effect in the same commit, so the
  // list would first be asked for page 7 of a set that no longer has one, and
  // only then for page 1 — two requests over the whole filtered set for one
  // dropdown change. React re-renders on this before touching children.
  if (lastSignature !== filterSignature) {
    setLastSignature(filterSignature);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), pageCount);

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
    [tableKey]
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

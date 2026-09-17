import { useCallback, useEffect, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * Client-side pagination over an already filtered and sorted row set.
 *
 * The tester's flights logbook was "eine unfassbar lange Liste" — 123 rows in
 * one scroll. The controller decision (owner-approved) is that pagination
 * happens HERE, in the browser, over rows the page already loaded, filtered
 * and sorted: the summary strip, the filter option lists and the "x
 * angezeigt" counter all keep reading the full set, so paging never narrows
 * what they report. This hook only slices the tail end for rendering.
 *
 * Sibling of `useColumnPrefs` / `useSortPrefs`: same localStorage shape, same
 * try/catch discipline (storage can throw), one file per concern.
 */

const STORAGE_PREFIX = "travstats:table-page-size:";
const DEFAULT_PAGE_SIZE = 50;

function readPageSize(tableKey: string): number | "all" {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableKey);
    if (raw === "all") return "all";
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
  } catch (err) {
    logger.warn("usePagination: unreadable preference, starting fresh", err);
    return DEFAULT_PAGE_SIZE;
  }
}

export interface Pagination<T> {
  paged: T[];
  page: number;
  pageCount: number;
  pageSize: number | "all";
  setPage: (page: number) => void;
  setPageSize: (size: number | "all") => void;
  total: number;
}

export function usePagination<T>(rows: readonly T[], tableKey: string): Pagination<T> {
  const [pageSize, setPageSizeState] = useState<number | "all">(() => readPageSize(tableKey));
  const [page, setPage] = useState<number>(1);

  // A filter narrowing the list, or a page-size change, can strand the reader
  // on a page number that no longer exists — reset to the first page rather
  // than showing an empty table under a filled-in filter bar. Only the row
  // COUNT is watched, not the array reference: re-sorting produces a new
  // array of the same length and must not bounce the reader back to page 1.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, pageSize]);

  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), pageCount);
  const paged =
    pageSize === "all"
      ? rows.slice()
      : rows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  const setPageSize = useCallback(
    (size: number | "all"): void => {
      setPageSizeState(size);
      try {
        localStorage.setItem(STORAGE_PREFIX + tableKey, String(size));
      } catch (err) {
        // Storage full or disabled: pagination still works, it just forgets.
        logger.warn("usePagination: could not persist the page size", err);
      }
    },
    [tableKey]
  );

  return {
    paged,
    page: clampedPage,
    pageCount,
    pageSize,
    setPage,
    setPageSize,
    total: rows.length,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { positiveIntParam, useQueryState } from "../../hooks/useQueryState";

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

export function usePagination<T>(
  rows: readonly T[],
  tableKey: string,
  /** The query parameter the page lives in. */
  pageParam = "page"
): Pagination<T> {
  const [pageSize, setPageSizeState] = useState<number | "all">(() => readPageSize(tableKey));
  // In the URL, so Back from an entry and a reload land on the page the
  // reader left (owner report 2026-11-23).
  const [page, setPage] = useQueryState(pageParam, 1, positiveIntParam);

  // A filter narrowing the list, or a page-size change, can strand the reader
  // on a page number that no longer exists — reset to the first page rather
  // than showing an empty table under a filled-in filter bar. Only the row
  // COUNT is watched, not the array reference: re-sorting produces a new
  // array of the same length and must not bounce the reader back to page 1.
  // The rows ARRIVING (none → some) is not a narrowing: that is the list
  // loading, and resetting then would throw a restored page 2 away.
  const previous = useRef({ length: rows.length, pageSize });
  useEffect(() => {
    const before = previous.current;
    previous.current = { length: rows.length, pageSize };
    const narrowed = before.length > 0 && before.length !== rows.length;
    if (narrowed || before.pageSize !== pageSize) setPage(1);
  }, [rows.length, pageSize, setPage]);

  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  // Not clamped before the rows are in: a restored page 2 must survive the load.
  const clampedPage = rows.length > 0 ? Math.min(Math.max(page, 1), pageCount) : 1;
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

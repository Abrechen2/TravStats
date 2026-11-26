import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { logger } from "../../../lib/logger";
import { LIST_SORT_KEYS, type ListSortKey } from "../../../types/placeList";

/** Remembered per list in this browser; the URL (`?sort=&order=`) wins when it names one. */
export const LIST_SORT_STORAGE_PREFIX = "travstats:place-list-sort:";
export const DEFAULT_LIST_SORT: { sort: ListSortKey; order: "asc" | "desc" } = {
  sort: "lastVisit",
  order: "desc",
};

const isKey = (v: unknown): v is ListSortKey =>
  typeof v === "string" && (LIST_SORT_KEYS as readonly string[]).includes(v);
const isOrder = (v: unknown): v is "asc" | "desc" => v === "asc" || v === "desc";

function stored(listId: string): { sort: ListSortKey; order: "asc" | "desc" } | null {
  try {
    const raw = localStorage.getItem(LIST_SORT_STORAGE_PREFIX + listId);
    if (!raw) return null;
    const v = JSON.parse(raw) as { sort?: unknown; order?: unknown };
    return isKey(v.sort) && isOrder(v.order) ? { sort: v.sort, order: v.order } : null;
  } catch (err: unknown) {
    logger.warn("useListSort: unreadable preference", err);
    return null;
  }
}

/** The order a key starts in when picked: dates, counts and "added" newest/most first. */
export const firstOrderOf = (key: ListSortKey): "asc" | "desc" =>
  key === "name" || key === "country" || key === "distance" || key === "custom" ? "asc" : "desc";

export function useListSort(listId: string): {
  sort: ListSortKey;
  order: "asc" | "desc";
  setSort: (sort: ListSortKey, order: "asc" | "desc") => void;
} {
  const [params, setParams] = useSearchParams();
  const urlSort = params.get("sort");
  const urlOrder = params.get("order");
  const current =
    isKey(urlSort) && isOrder(urlOrder)
      ? { sort: urlSort, order: urlOrder }
      : (stored(listId) ?? DEFAULT_LIST_SORT);

  const setSort = useCallback(
    (sort: ListSortKey, order: "asc" | "desc") => {
      try {
        localStorage.setItem(LIST_SORT_STORAGE_PREFIX + listId, JSON.stringify({ sort, order }));
      } catch (err: unknown) {
        logger.warn("useListSort: preference not stored", err);
      }
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("sort", sort);
          next.set("order", order);
          return next;
        },
        { replace: true }
      );
    },
    [listId, setParams]
  );

  return { ...current, setSort };
}

import { useCallback, useMemo } from "react";
import { useSortPrefs } from "../components/table/useSortPrefs";
import type { ColumnSort } from "../components/ui/Table";

type SortValue = string | number | Date | boolean | null | undefined;

interface UseSortOptions<T, K extends string> {
  /**
   * Names the list. The choice is remembered under this key, so a list keeps
   * its order across reloads and across browsers (see `useSortPrefs`).
   */
  tableKey: string;
  rows: readonly T[];
  /** One accessor per sortable column. A column without one is not sortable. */
  accessors: Record<K, (row: T) => SortValue>;
  defaultBy: K;
  defaultOrder?: "asc" | "desc";
  /** Columns that read best newest/largest first when first clicked. */
  descendingFirst?: readonly K[];
  /** BCP 47 tag for string comparison; the page's language. */
  locale?: string;
}

export interface UseSort<T, K extends string> {
  /** The rows in order. A new array; the input is never reordered. */
  rows: T[];
  sortBy: K;
  sortOrder: "asc" | "desc";
  toggle: (key: K) => void;
  /** The `sort` a `TableColumn` (or `SortButton`) takes for one column. */
  columnSort: (key: K, ariaLabel: string) => ColumnSort;
}

function compare(a: SortValue, b: SortValue, collator: Intl.Collator): number {
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b);
  const x = a instanceof Date ? a.getTime() : typeof a === "boolean" ? Number(a) : a;
  const y = b instanceof Date ? b.getTime() : typeof b === "boolean" ? Number(b) : b;
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
}

/**
 * Sort a list of rows by a column, and remember the choice per list.
 *
 * Abstention is a result: a row with no value for the sorted column goes LAST
 * in either direction. Sorting `null` as 0 would put "unknown" at the top of an
 * ascending list, which reads as the smallest value. Ties keep the incoming
 * order (stable), so a list that arrives pre-ordered does not reshuffle.
 */
export function useSort<T, K extends string>({
  tableKey,
  rows,
  accessors,
  defaultBy,
  defaultOrder = "asc",
  descendingFirst = [],
  locale,
}: UseSortOptions<T, K>): UseSort<T, K> {
  const known = useMemo(() => Object.keys(accessors) as K[], [accessors]);
  const { sortBy, sortOrder, setSort } = useSortPrefs<K>(tableKey, defaultBy, defaultOrder, known);
  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: "base" }),
    [locale]
  );

  const sorted = useMemo(() => {
    const read = accessors[sortBy];
    const sign = sortOrder === "asc" ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index, value: read(row) }))
      .sort((a, b) => {
        const aMissing = a.value === null || a.value === undefined || a.value === "";
        const bMissing = b.value === null || b.value === undefined || b.value === "";
        if (aMissing || bMissing)
          return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
        return sign * compare(a.value, b.value, collator) || a.index - b.index;
      })
      .map((entry) => entry.row);
  }, [rows, accessors, sortBy, sortOrder, collator]);

  const toggle = useCallback(
    (key: K) => {
      if (key === sortBy) setSort(key, sortOrder === "asc" ? "desc" : "asc");
      else setSort(key, descendingFirst.includes(key) ? "desc" : "asc");
    },
    [sortBy, sortOrder, setSort, descendingFirst]
  );

  const columnSort = useCallback(
    (key: K, ariaLabel: string): ColumnSort => ({
      active: key === sortBy,
      order: sortOrder,
      onSort: () => toggle(key),
      ariaLabel,
    }),
    [sortBy, sortOrder, toggle]
  );

  return { rows: sorted, sortBy, sortOrder, toggle, columnSort };
}

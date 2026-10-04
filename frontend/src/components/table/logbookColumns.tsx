import type { TableColumn } from "../ui/Table";
import { SortableHeader } from "./SortableHeader";

type ColumnLayout = Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & {
  align?: "end";
};

interface Options<Id extends string, Sort extends string> {
  /** Every column, in order. */
  ids: readonly Id[];
  layout: Record<Id, ColumnLayout>;
  isVisible: (id: Id) => boolean;
  label: (id: Id) => string;
  /** The columns a click sorts by, and the key each sends; absent = not sortable. */
  sortKeyByColumn: Partial<Record<Id, Sort>>;
  sortBy: Sort;
  sortOrder: "asc" | "desc";
  onSort: (key: Sort) => void;
  sortAriaLabel: (label: string) => string;
}

/**
 * The visible columns of a logbook table, with their layout and sort headers —
 * the head and every row read the same list, so a cell cannot land under the
 * wrong column. The rail and rental logbooks (forgejo#197) share it; the
 * flight and cruise pages build the same list inline, from before it existed.
 */
export function logbookColumns<Id extends string, Sort extends string>({
  ids,
  layout,
  isVisible,
  label,
  sortKeyByColumn,
  sortBy,
  sortOrder,
  onSort,
  sortAriaLabel,
}: Options<Id, Sort>): TableColumn[] {
  return ids
    .filter((id) => isVisible(id))
    .map((id) => {
      const text = label(id);
      const sortKey = sortKeyByColumn[id];
      return {
        key: id,
        ...layout[id],
        label:
          sortKey === undefined ? (
            text
          ) : (
            <SortableHeader
              column={sortKey}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
              ariaLabel={sortAriaLabel(text)}
            >
              {text}
            </SortableHeader>
          ),
      };
    });
}

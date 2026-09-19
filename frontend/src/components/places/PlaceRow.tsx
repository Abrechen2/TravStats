import type { ReactNode } from "react";
import type { JSX } from "react";
import { TableRow, type TableColumn } from "../ui/Table";
import { RowActionButton, RowActions } from "../table/RowActionButton";

export type PlaceSortKey =
  "name" | "category" | "location" | "country" | "continent" | "visits" | "lastVisit";
export type PlaceColumnId = PlaceSortKey | "status" | "actions";

export const PLACE_COLUMN_IDS: readonly PlaceColumnId[] = [
  "name",
  "category",
  "location",
  "country",
  "continent",
  "visits",
  "lastVisit",
  "status",
  "actions",
];

/**
 * Where each column goes once the table becomes a row below 640px.
 *
 * The place is the destination, the last visit says when, the pill says
 * whether it happened, is still ahead, or is a wish. Category, city, country,
 * continent and the visit count are read in the place itself.
 */
export const PLACE_COLUMN_LAYOUT: Record<
  PlaceColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  name: { min: 160, grow: 2, onNarrow: "title" },
  category: { min: 110, grow: 1, priority: 2 },
  location: { min: 110, grow: 1, priority: 2 },
  country: { min: 100, grow: 1, priority: 3 },
  continent: { min: 100, priority: 3 },
  visits: { min: 64, align: "end", mono: true, priority: 3 },
  lastVisit: { min: 100, mono: true, onNarrow: "subtitle" },
  status: { min: 110, onNarrow: "trailing" },
  actions: { min: 80, align: "end" },
};

interface Props {
  /** One cell per column id — the page owns the copy and the formatting. */
  cells: Record<Exclude<PlaceColumnId, "actions">, ReactNode>;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
  columns: readonly TableColumn[];
}

/**
 * A place row.
 *
 * Unlike the cruise and lodging rows this one takes its cells ready-made: the
 * places list resolves five of them through the page's own i18n instance
 * (`placeCountryLabel` needs `i18n.language`, `continentLabel` needs `t`), and
 * moving that into the row would have meant either a second translation
 * instance or five props that are just the values again.
 */
export function PlaceRow({
  cells,
  onOpen,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
  columns,
}: Props): JSX.Element {
  const all: Record<PlaceColumnId, ReactNode> = {
    ...cells,
    actions: (
      <RowActions>
        <RowActionButton icon="edit" label={editLabel} onClick={onEdit} />
        <RowActionButton icon="delete" label={deleteLabel} onClick={onDelete} />
      </RowActions>
    ),
  };
  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      cells={columns.map((column) => all[column.key as PlaceColumnId])}
    />
  );
}

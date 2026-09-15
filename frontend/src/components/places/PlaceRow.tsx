import type { ReactNode } from "react";
import type { JSX } from "react";
import { TableRow, type TableColumn } from "../ui/Table";
import type { NarrowPlace } from "../table/narrowColumns";
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
  { width: string; align?: "end"; mono?: boolean; onNarrow?: NarrowPlace }
> = {
  name: { width: "minmax(0,1.6fr)", onNarrow: "title" },
  category: { width: "minmax(0,1fr)" },
  location: { width: "minmax(0,1fr)" },
  country: { width: "minmax(0,1fr)" },
  continent: { width: "140px" },
  visits: { width: "96px", align: "end", mono: true },
  lastVisit: { width: "130px", mono: true, onNarrow: "subtitle" },
  status: { width: "140px", onNarrow: "trailing" },
  actions: { width: "96px", align: "end" },
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

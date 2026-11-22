import type { JSX, ReactNode } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { TourSummary } from "../../lib/api/tourIndex";
import PurposeChip from "../purpose/PurposeChip";
import { TableRow, type TableColumn } from "../ui/Table";

export type TourColumnId = "name" | "activity" | "trip" | "distance" | "ascent" | "actions";

export const TOUR_COLUMN_IDS: readonly TourColumnId[] = [
  "name",
  "activity",
  "trip",
  "distance",
  "ascent",
  "actions",
];

/** Widths follow the other logbooks' tables: the name grows, figures are mono and step aside first. */
export const TOUR_COLUMN_LAYOUT: Record<TourColumnId, Omit<TableColumn, "key" | "label">> = {
  name: { min: 200, grow: 2, onNarrow: "title" },
  activity: { min: 120, onNarrow: "trailing" },
  trip: { min: 140, grow: 1, priority: 3, onNarrow: "subtitle" },
  distance: { min: 100, align: "end", mono: true, priority: 2 },
  ascent: { min: 96, align: "end", mono: true, priority: 3 },
  actions: { min: 120, align: "end" },
};

interface Props {
  tour: TourSummary;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

function formatKm(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

/** One tour as a table row — the shape rail, bus and ferry rows have. */
export function TourTableRow({ tour, columns, onOpen, actions }: Props): JSX.Element {
  const { t } = useTranslation(["trips", "roadtrips"]);
  const cell: Record<string, ReactNode> = {
    name: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{tour.name}</span>
        <PurposeChip entry={tour} />
      </span>
    ),
    activity: (
      <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
        {tour.activity
          ? t(`roadtrips:activity.${tour.activity}`)
          : t(`trips:tours.mode.${tour.mode}`)}
      </span>
    ),
    // A tour with no trip says so, rather than showing a blank where every other row has a name.
    trip: <span className="text-(--text-muted)">{tour.tripName ?? t("trips:tours.noTrip")}</span>,
    distance: `${formatKm(tour.distanceKm)} km`,
    ascent: tour.ascentM !== null ? `↑ ${formatKm(tour.ascentM)} m` : "—",
    // The row opens the tour; a click on an action must not also reach it.
    // Keys too: Enter/Space on an action would bubble to the row's own handler and open the tour.
    actions: (
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {actions}
      </span>
    ),
  };
  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      testId={`tour-row-${tour.id}`}
      cells={columns.map((column) => cell[column.key])}
    />
  );
}

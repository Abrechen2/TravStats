import type { JSX } from "react";
import RememberedMarker from "../provenance/RememberedMarker";
import { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import { formatLocalDate } from "../../lib/displayFormat";
import { countryName } from "../../shared/geo/countryCode";
import { statusPillStyle } from "../table/statusPillStyle";
import { Table, TableRow, type TableColumn } from "../ui/Table";
import { useTableHints } from "../ui/useTableHints";
import { tripDays, tripSpan } from "./TripCard";

type TripColumnId = "name" | "dates" | "days" | "countries" | "status" | "places";

/** Trip status → the shared status palette (planned reads as scheduled). */
const STATUS_TONE: Record<Trip["status"], string> = {
  planned: "scheduled",
  in_progress: "in_progress",
  completed: "completed",
};

const LAYOUT: Record<TripColumnId, Omit<TableColumn, "key" | "label">> = {
  name: { min: 200, grow: 2, onNarrow: "title" },
  dates: { min: 200, mono: true, onNarrow: "subtitle" },
  days: { min: 72, align: "end", mono: true, priority: 2, onNarrow: "hide" },
  countries: { min: 160, grow: 1, priority: 3, onNarrow: "hide" },
  status: { min: 128, onNarrow: "trailing" },
  places: { min: 80, align: "end", mono: true, priority: 3, onNarrow: "hide" },
};
const ORDER: readonly TripColumnId[] = ["name", "dates", "days", "countries", "status", "places"];

/**
 * The trips as a table, the list view of the trips page: the same logbook
 * pieces (`Table`, `TableRow`) as rail and lodging. The rows come in the order
 * the page chose; the table does not sort again.
 */
export default function TripsTable({
  trips,
  onOpen,
  placeCounts,
  selection,
}: {
  trips: readonly Trip[];
  onOpen: (trip: Trip) => void;
  placeCounts: ReadonlyMap<string, number>;
  /** Merge mode: the picked trips. A row click toggles, so the pick is drawn on the row. */
  selection?: ReadonlySet<string>;
}): JSX.Element {
  const { t, i18n } = useTranslation(["trips"]);
  const hints = useTableHints();
  const columns: TableColumn[] = ORDER.map((key) => ({
    key,
    label: t(`trips:table.${key}`),
    ...LAYOUT[key],
  }));

  return (
    <Table columns={columns} label={t("trips:table.label")} {...hints}>
      {trips.map((trip) => {
        const { start, end } = tripSpan(trip);
        const days = tripDays(trip);
        const range = [start, end]
          .filter((d): d is string => d !== null)
          .map((d) => formatLocalDate(d))
          .filter((d, i, all) => all.indexOf(d) === i)
          .join(" – ");
        const places = placeCounts.get(trip.id) ?? 0;
        const cell: Record<TripColumnId, JSX.Element | string> = {
          name: (
            <span>
              {selection ? (
                <span aria-hidden="true" data-testid={`trip-row-pick-${trip.id}`}>
                  {selection.has(trip.id) ? "☑ " : "☐ "}
                </span>
              ) : null}
              {trip.icon ? <span aria-hidden="true">{trip.icon} </span> : null}
              <strong style={{ color: "var(--ts-text-bright)" }}>{trip.name}</strong>
            </span>
          ),
          dates: range || "—",
          days: days !== null ? String(days) : "—",
          countries: trip.countries.length
            ? trip.countries.map((cc) => countryName(cc, i18n.language)).join(", ")
            : "—",
          status: (
            <span className="inline-flex flex-col items-start gap-1">
              <span className="ts-status-pill" style={statusPillStyle(STATUS_TONE[trip.status])}>
                {t(`trips:status.${trip.status}`)}
              </span>
              <RememberedMarker entry={trip} />
            </span>
          ),
          places: places > 0 ? String(places) : "—",
        };
        return (
          <TableRow
            key={trip.id}
            testId={`trip-row-${trip.id}`}
            columns={columns}
            onClick={() => onOpen(trip)}
            cells={columns.map((column) => cell[column.key as TripColumnId])}
          />
        );
      })}
    </Table>
  );
}

import type { ReactNode } from "react";
import type { Cruise } from "../../types";
import TripPill from "../Trips/TripPill";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import { countUniquePorts, countUnresolvedPorts } from "./cruisePorts";
import { formatAmount } from "../../lib/units";
import { TableRow, type TableColumn } from "../ui/Table";

export type CruiseColumnId =
  "ship" | "line" | "dates" | "ports" | "status" | "cabin" | "price" | "trip" | "actions";

interface Props {
  cruise: Cruise;
  onOpen: () => void;
  actions?: JSX.Element;
  /** The visible columns, in order — the row renders exactly one cell each. */
  columns: readonly TableColumn[];
}

/**
 * Where each column goes once the table becomes a row below 640px.
 *
 * The ship names the journey, the dates say when, the status says what state
 * it is in — the three the owner asked to survive a phone. Everything else is
 * dropped there and read in the cruise itself. The widths are the desktop
 * grid; they have no effect narrow, where the grid is three areas.
 */
export const CRUISE_COLUMN_LAYOUT: Record<
  CruiseColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  ship: { min: 160, grow: 2, onNarrow: "title" },
  line: { min: 110, grow: 1, priority: 2 },
  dates: { min: 176, mono: true, onNarrow: "subtitle" },
  ports: { min: 64, align: "end", priority: 3 },
  status: { min: 110, onNarrow: "trailing" },
  cabin: { min: 90, mono: true, priority: 3 },
  price: { min: 84, align: "end", mono: true, priority: 3 },
  trip: { min: 110, grow: 1, priority: 2 },
  actions: { min: 88, align: "end" },
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
};

export function CruiseRow({ cruise, onOpen, actions, columns }: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const portsCount = countUniquePorts(cruise);
  const unresolvedCount = countUnresolvedPorts(cruise);
  const displayLine = cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "—";
  const displayShip = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  // Through the shared formatter, like every other price in the app: this row
  // used to print "3290.00 EUR" — two fixed decimals whatever the currency
  // (a yen amount has none), the code instead of the symbol, and the
  // machine's decimal point inside a German page.
  const price = cruise.price !== null ? formatAmount(cruise.price, cruise.currency) : "—";

  const cell: Record<CruiseColumnId, ReactNode> = {
    ship: displayShip,
    line: displayLine,
    dates: `${fmtDate(cruise.startDate)} – ${fmtDate(cruise.endDate)}`,
    ports: (
      <>
        {portsCount}
        {unresolvedCount > 0 && (
          <span
            className="ml-1 text-xs"
            title={t("list.unresolvedPorts", { count: unresolvedCount })}
            aria-label={t("list.unresolvedPorts", { count: unresolvedCount })}
          >
            (+{unresolvedCount})
          </span>
        )}
      </>
    ),
    status: (
      <span className="ts-status-pill" style={cruiseStatusPillStyle(cruise.status)}>
        {t(`status.${cruise.status}`)}
      </span>
    ),
    cabin: cruise.cabinNumber ?? "—",
    price,
    trip: (
      <span data-testid={`cruise-trip-cell-${cruise.id}`}>
        <TripPill trip={cruise.trip} />
      </span>
    ),
    // The row itself opens the cruise, so a click that lands on an action must
    // not also reach it — the defect measured in August, where deleting a
    // flight opened the edit dialog for the row underneath the button.
    actions: (
      <span data-testid={`cruise-actions-${cruise.id}`} onClick={(e) => e.stopPropagation()}>
        {actions}
      </span>
    ),
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      cells={columns.map((column) => cell[column.key as CruiseColumnId])}
    />
  );
}

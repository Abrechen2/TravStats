import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan, railDurationMinutes } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { formatRailDuration } from "../../lib/rail/railDuration";
import type { BusJourney } from "../../types/bus";
import { OperatorTile } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import TripPill from "../Trips/TripPill";
import { TableRow, type TableColumn } from "../ui/Table";

export type BusColumnId =
  "operator" | "route" | "time" | "line" | "duration" | "distance" | "status" | "trip" | "actions";

/**
 * The bus table's columns, in the shape every logbook uses — rail's
 * arrangement: the operator tile is the mark, the terminals the title, the
 * times the subtitle and the status the pill once the table collapses below
 * 640px.
 */
export const BUS_COLUMN_LAYOUT: Record<
  BusColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  operator: { min: 64, onNarrow: "mark" },
  route: { min: 200, grow: 2, onNarrow: "title" },
  // 236 and 112 are rail's widths, measured in a browser (2026-10-04): at
  // 196 / 84 "13.11.2026, 07:37 – 10:58" and "10 h 53 min" broke onto a
  // second line, and a coach ride reads the same two strings.
  time: { min: 236, mono: true, onNarrow: "subtitle" },
  line: { min: 120, grow: 1, priority: 2 },
  duration: { min: 112, align: "end", mono: true, priority: 2 },
  distance: { min: 112, align: "end", mono: true, priority: 3 },
  status: { min: 128, onNarrow: "trailing" },
  trip: { min: 110, grow: 1, priority: 3 },
  actions: { min: 88, align: "end" },
};

interface Props {
  journey: BusJourney;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

/**
 * One bus ride as a table row. A ride is one ticket between two terminals, so
 * unlike rail there is no connection to fold: one row, one page.
 *
 * The operator tile is a monogram on the domain colour — no logo source is
 * chosen for any operator (see `OperatorTile`, spec §11a).
 */
export function BusTableRow({ journey, columns, onOpen, actions }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["bus", "rail"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const departure = railDeparture(journey);
  const minutes = departure ? railDurationMinutes(departure, railArrival(journey)) : null;

  const delay =
    journey.delayMinutes === null
      ? null
      : journey.delayMinutes > 0
        ? t("bus:delay", { minutes: journey.delayMinutes })
        : t("bus:onTime");

  // A typed or traced figure stands bare; only the measured chord says so.
  const distance =
    journey.distanceKm === null ? (
      "—"
    ) : (
      <span className="flex flex-col items-end">
        <span>{`${Math.round(journey.distanceKm).toLocaleString(locale)} km`}</span>
        {journey.distanceSource === "great_circle" ? (
          <span className="t-caption">{t("bus:straightLine")}</span>
        ) : null}
      </span>
    );

  const cell: Record<BusColumnId, ReactNode> = {
    operator: <OperatorTile name={journey.operator} domain="bus" />,
    route: `${journey.depStationName} → ${journey.arrStationName}`,
    time: formatRailSpan(journey, locale) || "—",
    line: journey.lineName ?? "—",
    duration: minutes !== null ? formatRailDuration(minutes, t) : "—",
    distance,
    status: (
      <span className="flex flex-col items-start gap-1">
        <span {...statusPillProps(journey.status)} data-testid="bus-status">
          {t(`bus:status.${journey.status}`)}
        </span>
        {delay ? <span className="t-caption">{delay}</span> : null}
      </span>
    ),
    trip: <TripPill trip={journey.trip ?? null} />,
    // The row opens the ride; a click on an action must not also reach it.
    actions: <span onClick={(e) => e.stopPropagation()}>{actions}</span>,
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      testId={`bus-row-${journey.id}`}
      cells={columns.map((column) => cell[column.key as BusColumnId])}
    />
  );
}

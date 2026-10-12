import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan, railDurationMinutes } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { formatRailDuration } from "../../lib/rail/railDuration";
import type { FerryJourney } from "../../types/ferry";
import { OperatorTile } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import TripPill from "../Trips/TripPill";
import { TableRow, type TableColumn } from "../ui/Table";

export type FerryColumnId =
  | "operator"
  | "route"
  | "time"
  | "vessel"
  | "duration"
  | "distance"
  | "status"
  | "trip"
  | "actions";

export const FERRY_COLUMN_LAYOUT: Record<
  FerryColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  operator: { min: 64, onNarrow: "mark" },
  route: { min: 200, grow: 2, onNarrow: "title" },
  // 236 and 112 are rail's widths, measured in a browser (2026-10-04): at
  // 196 / 84 "13.11.2026, 07:37 – 10:58" and "10 h 53 min" broke onto a
  // second line; crossings use the same date and duration format.
  time: { min: 236, mono: true, onNarrow: "subtitle" },
  vessel: { min: 120, grow: 1, priority: 2 },
  duration: { min: 112, align: "end", mono: true, priority: 2 },
  distance: { min: 112, align: "end", mono: true, priority: 3 },
  status: { min: 128, onNarrow: "trailing" },
  trip: { min: 110, grow: 1, priority: 3 },
  actions: { min: 88, align: "end" },
};

interface Props {
  journey: FerryJourney;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

export function FerryTableRow({ journey, columns, onOpen, actions }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["ferry", "rail"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const departure = railDeparture(journey);
  const minutes = departure ? railDurationMinutes(departure, railArrival(journey)) : null;

  const delay =
    journey.delayMinutes === null
      ? null
      : journey.delayMinutes > 0
        ? t("ferry:delay", { minutes: journey.delayMinutes })
        : t("ferry:onTime");

  // Every figure says what it measures: "Luftlinie" only for the chord,
  // "laut Ticket" for the typed distance.
  const sourceKey = journey.distanceSource
    ? `ferry:distanceSource.${journey.distanceSource}`
    : null;
  const distance =
    journey.distanceKm === null ? (
      "—"
    ) : (
      <span className="flex flex-col items-end">
        <span>{`${Math.round(journey.distanceKm).toLocaleString(locale)} km`}</span>
        {sourceKey ? <span className="t-caption">{t(sourceKey)}</span> : null}
      </span>
    );

  const cell: Record<FerryColumnId, ReactNode> = {
    operator: <OperatorTile name={journey.operator} domain="ferry" />,
    route: `${journey.depStationName} → ${journey.arrStationName}`,
    time: formatRailSpan(journey, locale) || "—",
    vessel: journey.vesselName ?? "—",
    duration: minutes !== null ? formatRailDuration(minutes, t) : "—",
    distance,
    status: (
      <span className="flex flex-col items-start gap-1">
        <span {...statusPillProps(journey.status)} data-testid="ferry-status">
          {t(`ferry:status.${journey.status}`)}
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
      testId={`ferry-row-${journey.id}`}
      cells={columns.map((column) => cell[column.key as FerryColumnId])}
    />
  );
}

import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import {
  connectionDurationMinutes,
  connectionSpan,
  connectionStations,
  connectionStatus,
  connectionTrains,
} from "../../lib/rail/railConnection";
import { formatRailDuration } from "../../lib/rail/railDuration";
import { primaryOperator } from "../../lib/rail/primaryOperator";
import type { RailConnection, RailJourney } from "../../types/rail";
import { OperatorTile } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import TripPill from "../Trips/TripPill";
import { TableRow, type TableColumn } from "../ui/Table";
import { railDistanceNoteKey } from "./railDistanceLabel";
import { StationShortCode } from "./StationShortCode";
import { trainLabel } from "./trainLabel";

export type RailColumnId =
  "operator" | "route" | "time" | "train" | "duration" | "distance" | "status" | "trip" | "actions";

/**
 * The rail table's columns (forgejo#197), in the shape every logbook uses.
 * The operator tile is the mark, the stations the title, the times the
 * subtitle and the status the pill once the table collapses below 640px —
 * the flight row's arrangement, so the logbooks read alike.
 */
export const RAIL_COLUMN_LAYOUT: Record<
  RailColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  operator: { min: 64, onNarrow: "mark" },
  route: { min: 200, grow: 2, onNarrow: "title" },
  // "Mi., 01.07.26 08:15 – 12:09" plus a "+1" for an overnight ride.
  // 236 and 112: measured in a browser (2026-10-04) — at 196 / 84, "13.11.2026,
  // 07:37 – 10:58" and "10 h 53 min" broke onto a second line.
  time: { min: 236, mono: true, onNarrow: "subtitle" },
  train: { min: 120, grow: 1, priority: 2 },
  duration: { min: 112, align: "end", mono: true, priority: 2 },
  distance: { min: 112, align: "end", mono: true, priority: 3 },
  status: { min: 128, onNarrow: "trailing" },
  trip: { min: 110, grow: 1, priority: 3 },
  actions: { min: 88, align: "end" },
};

interface Props {
  connection: RailConnection;
  columns: readonly TableColumn[];
  onOpen: () => void;
  /** The row's action buttons; a ride with changes has none — its trains are edited on its page. */
  actions?: ReactNode;
}

function StationPair({ journey }: { journey: RailJourney }): JSX.Element {
  return (
    <>
      {journey.depStationName}
      <StationShortCode code={journey.depStationShortCode} /> → {journey.arrStationName}
      <StationShortCode code={journey.arrStationShortCode} />
    </>
  );
}

/**
 * One entry of the rail logbook as a table row. A direct ride is one train;
 * a ride with changes (forgejo#187) stays ONE row — start, every station
 * changed at, destination; first departure to last arrival; all trains — and
 * opens the connection's page, where each train is edited on its own.
 *
 * A ride with changes shows no distance: its legs may mix a straight line
 * with a traced one, and a sum would pass the mix off as one measurement.
 */
export function RailTableRow({ connection, columns, onOpen, actions }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["rail"]);
  const { legs } = connection;
  if (legs.length === 0) return null;
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const single = legs.length === 1 ? legs[0] : null;
  const span = connectionSpan(legs);
  const duration = connectionDurationMinutes(legs);
  const status = connectionStatus(legs);
  const trip = legs.every((leg) => leg.trip && leg.trip.id === legs[0].trip?.id)
    ? (legs[0].trip ?? null)
    : null;

  const delay =
    single === null || single.delayMinutes === null
      ? null
      : single.delayMinutes > 0
        ? t("rail:delay", { minutes: single.delayMinutes })
        : t("rail:onTime");

  const kmNoteKey = single ? railDistanceNoteKey(single.distanceSource) : null;
  const distance =
    single === null || single.distanceKm === null ? (
      "—"
    ) : (
      <span className="flex flex-col items-end">
        <span>{`${Math.round(single.distanceKm).toLocaleString(locale)} km`}</span>
        {kmNoteKey ? <span className="t-caption">{t(kmNoteKey)}</span> : null}
      </span>
    );

  const train = single ? (
    trainLabel(single) || "—"
  ) : (
    <span className="flex flex-col">
      <span>{connectionTrains(legs).join(" · ") || "—"}</span>
      <span className="t-caption">{t("rail:connection.changes", { count: legs.length - 1 })}</span>
    </span>
  );

  const cell: Record<RailColumnId, ReactNode> = {
    operator: <OperatorTile name={primaryOperator(legs)} domain="rail" />,
    route: single ? <StationPair journey={single} /> : connectionStations(legs).join(" → "),
    time: span ? formatRailSpan(span, locale) : "—",
    train,
    duration: duration !== null ? formatRailDuration(duration, t) : "—",
    distance,
    status: (
      <span className="flex flex-col items-start gap-1">
        {status ? (
          <span {...statusPillProps(status)} data-testid="rail-status">
            {t(`rail:status.${status}`)}
          </span>
        ) : null}
        {delay ? <span className="t-caption">{delay}</span> : null}
      </span>
    ),
    trip: <TripPill trip={trip} />,
    // The row opens the ride; a click on an action must not also reach it.
    actions: <span onClick={(e) => e.stopPropagation()}>{actions}</span>,
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      testId={single ? `rail-row-${single.id}` : `rail-connection-row-${connection.id}`}
      cells={columns.map((column) => cell[column.key as RailColumnId])}
    />
  );
}

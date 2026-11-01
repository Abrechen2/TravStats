import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan, railDurationMinutes } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { formatRailDuration } from "../../lib/rail/railDuration";
import type { BusJourney } from "../../types/bus";
import type { FerryJourney } from "../../types/ferry";
import { OperatorTile } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import TripPill from "../Trips/TripPill";
import { TableRow, type TableColumn } from "../ui/Table";
import { dateLocaleForLanguage } from "../../lib/units";

export type LegJourney = BusJourney | FerryJourney;

/** The column widths every leg logbook shares — rail's arrangement. */
export type LegColumnLayout<K extends string> = Record<
  K,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
>;

/**
 * The columns a bus or ferry table has in common, and rail's arrangement: the
 * operator tile is the mark, the terminals the title, the times the subtitle
 * and the status the pill once the table collapses below 640px. The one
 * domain-specific column (`line` / `vessel`) is added by the caller.
 *
 * 236 and 112 are rail's widths, measured in a browser (2026-10-04): at
 * 196 / 84 "13.11.2026, 07:37 – 10:58" and "10 h 53 min" broke onto a second
 * line, and a coach ride or a crossing reads the same two strings.
 */
export function legColumnLayout<S extends string>(
  serviceColumn: S
): LegColumnLayout<
  "operator" | "route" | "time" | S | "duration" | "distance" | "status" | "trip" | "actions"
> {
  return {
    operator: { min: 64, onNarrow: "mark" },
    route: { min: 200, grow: 2, onNarrow: "title" },
    time: { min: 236, mono: true, onNarrow: "subtitle" },
    [serviceColumn]: { min: 120, grow: 1, priority: 2 },
    duration: { min: 112, align: "end", mono: true, priority: 2 },
    distance: { min: 112, align: "end", mono: true, priority: 3 },
    status: { min: 128, onNarrow: "trailing" },
    trip: { min: 110, grow: 1, priority: 3 },
    actions: { min: 88, align: "end" },
  } as LegColumnLayout<
    "operator" | "route" | "time" | S | "duration" | "distance" | "status" | "trip" | "actions"
  >;
}

/** What differs between the legs that share this row (bus, ferry). */
export interface LegTableDomain {
  ns: "bus" | "ferry";
  /** The key of the column that shows the line (bus) or the vessel (ferry). */
  serviceColumn: "line" | "vessel";
  service: (journey: LegJourney) => string | null;
  /** i18n key naming what a distance figure measures, or null when unknown. */
  distanceSourceKey: (journey: LegJourney) => string | null;
}

interface Props {
  domain: LegTableDomain;
  journey: LegJourney;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

/**
 * One bus or ferry ride as a table row. A ride is one ticket between two
 * terminals, so unlike rail there is no connection to fold: one row, one page.
 *
 * The operator tile is a monogram on the domain colour — no logo source is
 * chosen for any operator (see `OperatorTile`, spec §11a).
 */
export function LegTableRow({ domain, journey, columns, onOpen, actions }: Props): JSX.Element {
  const { ns } = domain;
  const { t, i18n } = useTranslation([ns, "rail"]);
  const locale = dateLocaleForLanguage(i18n.language);
  const departure = railDeparture(journey);
  const minutes = departure ? railDurationMinutes(departure, railArrival(journey)) : null;

  const delay =
    journey.delayMinutes === null
      ? null
      : journey.delayMinutes > 0
        ? t(`${ns}:delay`, { minutes: journey.delayMinutes })
        : t(`${ns}:onTime`);

  // Every figure says what it measures: "Luftlinie" only for the chord,
  // "Straße" for a routed length, "laut Ticket" for the typed one.
  const sourceKey = domain.distanceSourceKey(journey);
  const distance =
    journey.distanceKm === null ? (
      "—"
    ) : (
      <span className="flex flex-col items-end">
        <span>{`${Math.round(journey.distanceKm).toLocaleString(locale)} km`}</span>
        {sourceKey ? <span className="t-caption">{t(sourceKey)}</span> : null}
      </span>
    );

  const cell: Record<string, ReactNode> = {
    operator: <OperatorTile name={journey.operator} domain={ns} />,
    route: `${journey.depStationName} → ${journey.arrStationName}`,
    time: formatRailSpan(journey, locale) || "—",
    [domain.serviceColumn]: domain.service(journey) ?? "—",
    duration: minutes !== null ? formatRailDuration(minutes, t) : "—",
    distance,
    status: (
      <span className="flex flex-col items-start gap-1">
        <span {...statusPillProps(journey.status)} data-testid={`${ns}-status`}>
          {t(`${ns}:status.${journey.status}`)}
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
      testId={`${ns}-row-${journey.id}`}
      cells={columns.map((column) => cell[column.key])}
    />
  );
}

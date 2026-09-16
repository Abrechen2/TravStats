import type { ReactNode } from "react";
import type { JSX } from "react";
import type { Flight, Trip } from "../../types";
import { TableRow, type TableColumn } from "../ui/Table";
import AirlineWordmarkCell from "./AirlineWordmarkCell";
import RouteCell from "./RouteCell";
import TimeCell from "./TimeCell";
import FlightStatusCell from "./FlightStatusCell";
import SourceInfoDot from "./SourceInfoDot";
import TripBadgeCell from "./TripBadgeCell";
import { flightDateFmt } from "./flightDateFormat";
import SpecialTypeBadge from "../specialFlights/SpecialTypeBadge";
import type { SpecialType } from "../specialFlights/specialTypeMeta";
import type { FlightColumnId } from "./flightColumns";

/**
 * Where each column goes once the table becomes a row below 640px.
 *
 * The airline tile is the mark, the route is the title, the status is the
 * pill on the right. The date does NOT come from the time column: that cell
 * is a two-line ab/an block with airport-local times and an overnight marker,
 * and squeezing it into a 12px subtitle would lose the thing it exists to
 * say. The row composes "date · flight number · duration" instead, which is
 * what the design round asked for, and the time column simply drops.
 */
export const FLIGHT_COLUMN_LAYOUT: Record<
  FlightColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  airline: { min: 48, onNarrow: "mark" },
  flightNumber: { min: 72, mono: true, priority: 2 },
  route: { min: 140, grow: 2, onNarrow: "title" },
  time: { min: 170 },
  status: { min: 100, onNarrow: "trailing" },
  duration: { min: 72, align: "end", mono: true, priority: 3 },
  aircraft: { min: 104, grow: 1, mono: true, priority: 3 },
  price: { min: 80, align: "end", mono: true, priority: 3 },
  trip: { min: 100, grow: 1, priority: 2 },
  actions: { min: 84, align: "end" },
};

interface Props {
  flight: Flight;
  trip: Trip | undefined;
  columns: readonly TableColumn[];
  /** Everything the page already knows how to render for this flight. */
  cells: {
    flightNumber: ReactNode;
    duration: ReactNode;
    aircraft: ReactNode;
    price: ReactNode;
  };
  /** The compact duration, for the phone's summary line. */
  durationText: string;
  language: string;
  onOpen: () => void;
  actions: ReactNode;
}

export function FlightRow({
  flight,
  trip,
  columns,
  cells,
  durationText,
  language,
  onOpen,
  actions,
}: Props): JSX.Element {
  const departure = flight.departureTime;
  const summary = [
    departure ? flightDateFmt(departure, flight.depTimezone || "UTC", language) : null,
    flight.flightNumber || null,
    durationText || null,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

  const cell: Record<FlightColumnId, ReactNode> = {
    airline: (
      <>
        <AirlineWordmarkCell flight={flight} />
        {flight.specialType && (
          <div className="mt-1">
            <SpecialTypeBadge type={flight.specialType as SpecialType} />
          </div>
        )}
      </>
    ),
    flightNumber: cells.flightNumber,
    route: <RouteCell flight={flight} />,
    time: <TimeCell flight={flight} />,
    status: <FlightStatusCell flight={flight} />,
    duration: cells.duration,
    aircraft: cells.aircraft,
    price: cells.price,
    trip: <TripBadgeCell trip={trip} />,
    actions: (
      <span className="inline-flex items-center justify-end gap-1.5">
        {actions}
        <span className="inline-flex w-[18px] justify-center">
          <SourceInfoDot flight={flight} />
        </span>
      </span>
    ),
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      narrowSubtitle={summary}
      cells={columns.map((column) => cell[column.key as FlightColumnId])}
    />
  );
}

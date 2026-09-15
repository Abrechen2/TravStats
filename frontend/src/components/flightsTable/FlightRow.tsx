import type { ReactNode } from "react";
import type { JSX } from "react";
import type { Flight, Trip } from "../../types";
import { TableRow, type TableColumn } from "../ui/Table";
import type { NarrowPlace } from "../table/narrowColumns";
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
  { width: string; align?: "end"; mono?: boolean; onNarrow?: NarrowPlace }
> = {
  airline: { width: "200px", onNarrow: "mark" },
  flightNumber: { width: "120px", mono: true },
  route: { width: "minmax(0,1.6fr)", onNarrow: "title" },
  time: { width: "210px" },
  status: { width: "140px", onNarrow: "trailing" },
  duration: { width: "110px", align: "end", mono: true },
  aircraft: { width: "130px", mono: true },
  price: { width: "120px", align: "end", mono: true },
  trip: { width: "150px" },
  actions: { width: "120px", align: "end" },
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

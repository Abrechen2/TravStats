import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRentalPeriod } from "../../lib/rentalTime";
import type { RentalBooking } from "../../types/rental";
import { OperatorTile } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import TripPill from "../Trips/TripPill";
import { TableRow, type TableColumn } from "../ui/Table";

export type RentalColumnId =
  "provider" | "route" | "period" | "vehicle" | "km" | "status" | "trip" | "actions";

/**
 * The rental table's columns (forgejo#197), arranged like the other logbooks:
 * the provider tile is the mark, provider and stations the title, the period
 * the subtitle and the status the pill below 640px.
 */
export const RENTAL_COLUMN_LAYOUT: Record<
  RentalColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "mono" | "onNarrow"> & { align?: "end" }
> = {
  provider: { min: 64, onNarrow: "mark" },
  route: { min: 200, grow: 2, onNarrow: "title" },
  period: { min: 200, onNarrow: "subtitle" },
  vehicle: { min: 120, grow: 1, priority: 2 },
  km: { min: 96, align: "end", mono: true, priority: 3 },
  status: { min: 128, onNarrow: "trailing" },
  trip: { min: 110, grow: 1, priority: 3 },
  actions: { min: 88, align: "end" },
};

const stationLabel = (name: string, iata: string | null): string =>
  iata ? `${name} (${iata})` : name;

interface Props {
  rental: RentalBooking;
  columns: readonly TableColumn[];
  onOpen: () => void;
  actions?: ReactNode;
}

/**
 * One rental as a table row: provider and stations, the period on the
 * stations' calendars, the car and its plate, and the km figure — or
 * "km offen" once a returned rental still waits for its invoice (a booked or
 * cancelled one has no km to wait for). A status pill appears only when the
 * rental is not simply done.
 */
export function RentalTableRow({ rental, columns, onOpen, actions }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const route = rental.oneWay
    ? `${stationLabel(rental.pickupStationName, rental.pickupIata)} → ${stationLabel(
        rental.returnStationName,
        rental.returnIata
      )}`
    : stationLabel(rental.pickupStationName, rental.pickupIata);
  const kind = [
    rental.oneWay ? t("rental:list.oneWay") : t("rental:list.sameStation"),
    rental.broker ? t("rental:list.viaBroker", { broker: rental.broker }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const km =
    rental.distanceKm !== null ? (
      `${rental.distanceKm.toLocaleString(locale)} km${
        rental.distanceSource === "user" ? ` (${t("rental:distance.user")})` : ""
      }`
    ) : rental.status === "completed" ? (
      <span
        className="rounded-full border border-dashed border-border px-2 text-xs"
        data-testid="rental-km-open"
      >
        {t("rental:list.kmOpen")}
      </span>
    ) : (
      "—"
    );

  const cell: Record<RentalColumnId, ReactNode> = {
    provider: <OperatorTile name={rental.provider} domain="rental" />,
    route: (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{`${rental.provider} · ${route}`}</span>
        <span className="t-caption truncate">{kind}</span>
      </span>
    ),
    period: `${formatRentalPeriod(rental.times, locale)} · ${t("rental:list.days", {
      count: rental.rentalDays,
    })}`,
    vehicle:
      rental.vehicleClass || rental.licensePlate ? (
        <span className="flex min-w-0 flex-col">
          {rental.vehicleClass ? <span className="truncate">{rental.vehicleClass}</span> : null}
          {rental.licensePlate ? (
            <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
              {rental.licensePlate}
            </span>
          ) : null}
        </span>
      ) : (
        "—"
      ),
    km,
    status:
      rental.status !== "completed" ? (
        <span {...statusPillProps(rental.status)} data-testid="rental-status">
          {t(`rental:status.${rental.status}`)}
        </span>
      ) : null,
    trip: <TripPill trip={rental.trip ?? null} />,
    // The row opens the rental; a click on an action must not also reach it.
    actions: <span onClick={(e) => e.stopPropagation()}>{actions}</span>,
  };

  return (
    <TableRow
      columns={columns}
      onClick={onOpen}
      testId={`rental-row-${rental.id}`}
      cells={columns.map((column) => cell[column.key as RentalColumnId])}
    />
  );
}

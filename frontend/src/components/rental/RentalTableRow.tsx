import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRentalPeriod } from "../../lib/rentalTime";
import { rentalDrivenKm } from "../../shared/rentalCounting";
import type { RentalBooking } from "../../types/rental";
import { OperatorTile, rentalProviderLogoUrl } from "../table/OperatorTile";
import { statusPillProps } from "../table/statusPillStyle";
import { rentalDeposit } from "../../lib/rental/rentalDeposit";
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
  // 256: measured in a browser (2026-10-04) — at 200, "12.08.2026 - 19.08.2026 ·
  // 7 Tage" broke onto a second line.
  period: { min: 256, onNarrow: "subtitle" },
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
 * stations' calendars, the car (the one driven, else the booked class) and its
 * plate, and the km figure — or
 * "km offen" once a returned rental still waits for its invoice (a booked or
 * cancelled one has no km to wait for). Every row carries its status pill.
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

  // The invoice's figure, a correction, or in − out of the two odometer
  // readings — the one rule (`rentalDrivenKm`, forgejo#206). Only a hand
  // correction is labelled as such.
  const driven = rentalDrivenKm(rental);
  const km =
    driven !== null ? (
      `${driven.km.toLocaleString(locale)} km${
        driven.source === "user" ? ` (${t("rental:distance.user")})` : ""
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

  // The car actually driven, when known; the booked class only stands in for
  // it (forgejo#205) — "Compact" says what was promised, not what was driven.
  const vehicle = rental.vehicleDriven || rental.vehicleClass;

  const depositState = rentalDeposit(rental).state;
  const depositOutstanding = depositState === "open" || depositState === "partial";
  const cell: Record<RentalColumnId, ReactNode> = {
    provider: (
      <OperatorTile
        name={rental.provider}
        domain="rental"
        logoUrl={rentalProviderLogoUrl(rental.provider)}
      />
    ),
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
      vehicle || rental.licensePlate ? (
        <span className="flex min-w-0 flex-col">
          {vehicle ? (
            <span className="truncate" data-testid="rental-vehicle">
              {vehicle}
            </span>
          ) : null}
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
    // Always a pill, like the rail list (forgejo#207): the stored status is the
    // cache of `deriveRentalStatus` the status sweep keeps current, and an
    // empty cell read as "unknown" rather than "done".
    status: (
      <span className="inline-flex flex-col items-start gap-1">
        <span {...statusPillProps(rental.status)} data-testid="rental-status">
          {t(`rental:status.${rental.status}`)}
        </span>
        {/* A deposit still held after the car is back is easy to forget (forgejo#238). */}
        {depositOutstanding ? (
          <span className="t-caption text-(--warning)" data-testid="rental-deposit-open">
            {t("rental:list.depositOpen")}
          </span>
        ) : null}
      </span>
    ),
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

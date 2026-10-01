import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRentalPeriod } from "../../lib/rentalTime";
import type { RentalBooking } from "../../types/rental";
import { Icon } from "../ui/Icon";

interface Props {
  rental: RentalBooking;
  onEdit: (rental: RentalBooking) => void;
  onDelete: (rental: RentalBooking) => void;
}

const stationLabel = (name: string, iata: string | null): string =>
  iata ? `${name} (${iata})` : name;

/**
 * One rental in the logbook — the row shape of flights and rail (concept
 * page 2026-10-01): the domain colour at the left, provider and stations,
 * the period on the stations' calendars, and the km figure — or "km offen"
 * once a returned rental still waits for its invoice (a booked or cancelled
 * one has no km to wait for). A status pill appears
 * only when the rental is not simply done. Real buttons, not a clickable row.
 */
export function RentalRow({ rental, onEdit, onDelete }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const route = rental.oneWay
    ? `${stationLabel(rental.pickupStationName, rental.pickupIata)} → ${stationLabel(
        rental.returnStationName,
        rental.returnIata
      )}`
    : stationLabel(rental.pickupStationName, rental.pickupIata);
  const details = [
    rental.vehicleClass,
    rental.oneWay ? t("rental:list.oneWay") : t("rental:list.sameStation"),
    rental.broker ? t("rental:list.viaBroker", { broker: rental.broker }) : null,
  ].filter((part): part is string => Boolean(part));
  const km =
    rental.distanceKm === null
      ? null
      : `${rental.distanceKm.toLocaleString(locale)} km${
          rental.distanceSource === "user" ? ` (${t("rental:distance.user")})` : ""
        }`;

  return (
    <li
      data-testid={`rental-row-${rental.id}`}
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      style={{
        borderBottom: "1px solid var(--ts-border)",
        borderLeft: "3px solid var(--ts-domain-rental)",
        paddingLeft: 10,
      }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span style={{ color: "var(--ts-domain-rental)" }}>
          <Icon name="car" size={20} />
        </span>
        <div className="min-w-0">
          <Link to={`/rentals/${rental.id}`} className="font-semibold hover:underline">
            {rental.provider} · {route}
          </Link>
          <div className="t-caption">{details.join(" · ")}</div>
          {rental.trip ? <div className="t-caption">{rental.trip.name}</div> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {rental.status !== "completed" ? (
          <span
            className="t-caption rounded-full border border-border px-2"
            data-testid="rental-status"
          >
            {t(`rental:status.${rental.status}`)}
          </span>
        ) : null}
        {km ? (
          <span className="font-mono text-sm">{km}</span>
        ) : rental.status !== "completed" ? null : (
          <span
            className="rounded-full border border-dashed border-border px-2 text-xs"
            data-testid="rental-km-open"
          >
            {t("rental:list.kmOpen")}
          </span>
        )}
        <span className="t-caption">
          {formatRentalPeriod(rental.times, locale)} ·{" "}
          {t("rental:list.days", { count: rental.rentalDays })}
        </span>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm"
          onClick={(): void => onEdit(rental)}
        >
          {t("rental:edit")}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm"
          onClick={(): void => onDelete(rental)}
        >
          {t("rental:delete")}
        </button>
      </div>
    </li>
  );
}

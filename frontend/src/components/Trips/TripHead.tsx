import type { JSX } from "react";
import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import { formatDateInTimezone } from "../../lib/dateUtils";
import { FlagImg } from "../../lib/countryFlag";
import { countryName } from "../../shared/geo/countryCode";
import { statusPillStyle } from "../table/statusPillStyle";
import Button from "../ui/Button";

/** Trip status → the shared status palette (planned reads as scheduled). */
const STATUS_TONE: Record<Trip["status"], string> = {
  planned: "scheduled",
  in_progress: "in_progress",
  completed: "completed",
};

interface TripHeadProps {
  trip: Trip;
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * The head of a trip page, round 4 ("Reise Detail"): status and a mono line
 * of dates, days and countries, the name large, the countries as flag chips,
 * and the two actions every detail page carries.
 *
 * It replaces a 240px banner whose gradient came from the trip colour and
 * whose text sat on a dark overlay — a picture of a trip where the export
 * asks for the trip's facts. A cover image, where one is set, still shows,
 * behind the card at low strength.
 */
export default function TripHead({
  trip,
  locale,
  t,
  onEdit,
  onDelete,
}: TripHeadProps): JSX.Element {
  const days =
    trip.startDate && trip.endDate
      ? differenceInCalendarDays(new Date(trip.endDate), new Date(trip.startDate)) + 1
      : null;
  const range = [trip.startDate, trip.endDate]
    .filter((d): d is string => Boolean(d))
    .map((d) => formatDateInTimezone(d, "UTC"));
  const meta = [
    range.length === 2 && range[0] !== range[1] ? `${range[0]} – ${range[1]}` : range[0],
    days !== null && days > 0 ? t("trips:head.days", { count: days }) : null,
    trip.countries.length > 0 ? t("trips:head.countries", { count: trip.countries.length }) : null,
    trip.destinationLabel,
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: "var(--ts-space-lg)" }}>
      <Link
        to="/trips"
        className="ts-back-link"
        style={{
          display: "inline-flex",
          gap: 6,
          marginBottom: "var(--ts-space-md)",
          fontSize: 13,
          color: "var(--ts-muted)",
        }}
      >
        <span aria-hidden>←</span>
        {t("trips:tab")}
      </Link>
      <div
        className="relative overflow-hidden"
        style={{
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "var(--ts-space-xl)",
        }}
      >
        {trip.coverImageUrl && (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${trip.coverImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.18,
            }}
          />
        )}
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-sm)" }}>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span className="ts-status-pill" style={statusPillStyle(STATUS_TONE[trip.status])}>
                {t(`trips:status.${trip.status}`)}
              </span>
              {meta.length > 0 && (
                <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                  {meta.join(" · ")}
                </span>
              )}
            </div>
            <h1
              className="t-screen-title"
              style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.1 }}
            >
              {trip.icon && (
                <span aria-hidden="true" style={{ marginRight: 10 }}>
                  {trip.icon}
                </span>
              )}
              <span>{trip.name}</span>
            </h1>
            {trip.countries.length > 0 && (
              <ul className="flex flex-wrap" style={{ gap: 6 }}>
                {trip.countries.map((cc) => (
                  <li
                    key={cc}
                    className="inline-flex items-center rounded-full"
                    style={{
                      gap: 8,
                      padding: "4px 12px 4px 8px",
                      background: "var(--ts-surface2)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ts-text-bright)",
                    }}
                  >
                    <FlagImg country={cc} />
                    {countryName(cc, locale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Button onClick={onEdit}>{t("common:buttons.edit")}</Button>
            <Button variant="danger" onClick={onDelete}>
              {t("common:buttons.delete")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

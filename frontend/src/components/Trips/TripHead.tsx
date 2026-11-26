import { Icon } from "../ui/Icon";
import CoverImage from "./CoverImage";
import AutoCoverNote from "./AutoCoverNote";
import CoverCropHost from "./CoverCropHost";
import { useMemo, useState } from "react";
import RememberedMarker from "../provenance/RememberedMarker";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import BackLink from "../navigation/BackLink";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import { formatLocalDate } from "../../lib/displayFormat";
import { tripEnd, tripStart } from "../../lib/entityTimes";
import type { TripPlaceVisit } from "../../hooks/useTripPlaceVisits";
import { buildTimelineEvents } from "../../lib/tripTimelineEvents";
import { findTimelineInconsistencies } from "../../lib/tripTimelinePlausibility";
import { FlagImg } from "../../lib/countryFlag";
import { countryName } from "../../shared/geo/countryCode";
import { statusPillStyle } from "../table/statusPillStyle";
import Button from "../ui/Button";
import CoverSuggestPrompt from "./CoverSuggestPrompt";
import TripMoreMenu from "./TripMoreMenu";
import TripTravellers from "./TripTravellers";

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
  /** The trip changed from the head (sharing added a traveller): reload it. */
  onChanged: () => void;
  /** Distinct places visited on the trip (`countTripPlaces`); shown only when above 0. */
  placeCount?: number;
  /** The trip's place visits, so the count equals the timeline's (forgejo#426). */
  placeVisits?: readonly TripPlaceVisit[];
}

const NO_VISITS: readonly TripPlaceVisit[] = [];

/**
 * The head of a trip page, round 4 ("Reise Detail"): status and a mono line
 * of dates, days and countries, the name large, the countries as flag chips,
 * and "Bearbeiten" with the "Mehr" menu that holds the rest.
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
  onChanged,
  placeCount = 0,
  placeVisits = NO_VISITS,
}: TripHeadProps): JSX.Element {
  // The cover URL that failed to load: its photo is gone, so the hint replaces the picture.
  const [brokenCover, setBrokenCover] = useState<string | null>(null);
  // Entries that contradict each other (forgejo#426); the timeline names each one.
  const inconsistencies = useMemo(
    () =>
      new Set(
        findTimelineInconsistencies(buildTimelineEvents(trip, placeVisits)).map((f) => f.eventId)
      ).size,
    [trip, placeVisits]
  );
  // The trip's days at its places (`times`), never moved by the reader's zone.
  const start = tripStart(trip)?.date;
  const end = tripEnd(trip)?.date;
  const days =
    start && end
      ? Math.round(
          (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
        ) + 1
      : null;
  const range = [start, end].filter((d): d is string => Boolean(d)).map((d) => formatLocalDate(d));
  const meta = [
    range.length === 2 && range[0] !== range[1] ? `${range[0]} – ${range[1]}` : range[0],
    days !== null && days > 0 ? t("trips:head.days", { count: days }) : null,
    trip.countries.length > 0 ? t("trips:head.countries", { count: trip.countries.length }) : null,
    trip.destinationLabel,
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: "var(--ts-space-lg)" }}>
      <BackLink
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
      </BackLink>
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
          <CoverImage
            url={trip.coverImageUrl}
            crop={trip.coverCrop}
            opacity={0.18}
            onBroken={() => setBrokenCover(trip.coverImageUrl)}
          />
        )}
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-sm)" }}>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span className="ts-status-pill" style={statusPillStyle(STATUS_TONE[trip.status])}>
                {t(`trips:status.${trip.status}`)}
              </span>
              <RememberedMarker entry={trip} />
              {meta.length > 0 && (
                <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                  {meta.join(" · ")}
                </span>
              )}
              {inconsistencies > 0 && (
                <Link
                  to="?tab=timeline"
                  className="t-caption underline"
                  style={{
                    fontFamily: "var(--ts-font-mono)",
                    color: "var(--color-warning, inherit)",
                  }}
                  data-testid="trip-head-inconsistencies"
                >
                  <Icon name="triangle-alert" size={14} className="mr-1 inline" />{" "}
                  {t("trips:detail.plausibility.count", { count: inconsistencies })}
                </Link>
              )}
              {placeCount > 0 && (
                <Link
                  to="?tab=overview#trip-places"
                  className="t-caption underline"
                  style={{ fontFamily: "var(--ts-font-mono)" }}
                  data-testid="trip-head-places"
                >
                  {placeCount} {t("trips:card.places", { count: placeCount })}
                </Link>
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
            <TripTravellers tripId={trip.id} companions={trip.companions} />
            {!trip.coverImageUrl && <CoverSuggestPrompt tripId={trip.id} onChosen={onChanged} />}
            {trip.coverImageUrl && brokenCover === trip.coverImageUrl && (
              <CoverSuggestPrompt
                tripId={trip.id}
                onChosen={onChanged}
                label="cover.unavailable"
                testId="cover-unavailable"
              />
            )}
            {trip.coverImageUrl &&
              trip.coverSource === "auto" &&
              brokenCover !== trip.coverImageUrl && (
                <AutoCoverNote trip={trip} onChanged={onChanged} />
              )}
          </div>
          <div className="flex shrink-0 flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Button onClick={onEdit}>{t("common:buttons.edit")}</Button>
            <TripMoreMenu trip={trip} language={locale} onDelete={onDelete} onChanged={onChanged} />
          </div>
        </div>
      </div>
      <CoverCropHost onSaved={onChanged} />
    </div>
  );
}

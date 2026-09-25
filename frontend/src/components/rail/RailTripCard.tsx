import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import { useTranslation } from "../../hooks/useTranslation";
import { formatStationClock, formatStationTime } from "../../lib/railTime";
import { formatAmount } from "../../lib/units";
import type { TripRailJourney } from "../../types/rail";

/** "ICE 578 · DB Fernverkehr" — whatever of the three is known. */
function trainOf(journey: TripRailJourney): string | null {
  const train = [journey.trainCategory, journey.trainNumber].filter(Boolean).join(" ");
  return [train, journey.operator].filter(Boolean).join(" · ") || null;
}

/**
 * A train ride on the trip timeline (spec 2026-09-25-rail-domain, phase 2b).
 * Its times are on each station's clock, as everywhere rail is shown; an
 * unrecorded delay says so rather than reading as on time. Opens in place, and
 * links to the journey's own page for the rest.
 */
export function RailTripCard({
  journey,
  date,
}: {
  journey: TripRailJourney;
  date: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["rail", "trips"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const [open, setOpen] = useState(false);
  const when = `${formatStationTime(journey.departureTime, journey.depTimezone, locale)}${
    journey.arrivalTime
      ? ` → ${formatStationClock(journey.arrivalTime, journey.arrTimezone, locale)}`
      : ""
  }`;
  const delay =
    journey.delayMinutes === null
      ? t("rail:detail.delayUnknown")
      : journey.delayMinutes > 0
        ? t("rail:delay", { minutes: journey.delayMinutes })
        : t("rail:onTime");
  const rows: Array<[string, string | null]> = [
    [t("rail:form.train"), trainOf(journey)],
    [t("rail:detail.delay"), journey.status === "completed" ? delay : null],
    [
      t("rail:form.price"),
      journey.price !== null
        ? formatAmount(journey.price, journey.currency, { language: i18n.language })
        : null,
    ],
  ];
  return (
    <ExpandableEventCard
      icon="🚆"
      bg="var(--domain-rail-soft)"
      iconColor="var(--domain-rail)"
      title={`${journey.depStationName} → ${journey.arrStationName}`}
      subtitle={when}
      date={date}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      {rows
        .filter((row): row is [string, string] => row[1] !== null)
        .map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-xs">
            <span style={{ color: "var(--text-muted)" }}>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      <Link
        to={`/rail/${journey.id}`}
        className="text-xs"
        style={{ color: "var(--accent)" }}
        data-testid="rail-trip-card-open"
      >
        {t("rail:trip.open")}
      </Link>
    </ExpandableEventCard>
  );
}

/**
 * The trip's rail journeys as a logistics list, beside its flights and
 * cruises. Separate from the page because that page is frozen at its size.
 */
export function TripRailList({ journeys }: { journeys: readonly TripRailJourney[] }): JSX.Element {
  const { t, i18n } = useTranslation(["rail"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      data-testid="trip-rail-list"
    >
      <div className="px-4 py-3 text-sm font-semibold">
        {t("rail:trip.listTitle", { count: journeys.length })}
      </div>
      <ul className="text-sm">
        {journeys.map((j) => (
          <li
            key={j.id}
            className="flex justify-between gap-3 px-4 py-2.5"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <span style={{ color: "var(--text-muted)" }}>
              {formatStationTime(j.departureTime, j.depTimezone, locale)}
            </span>
            <span className="flex-1">
              {j.depStationName} → {j.arrStationName}
            </span>
            <Link to={`/rail/${j.id}`} className="text-xs" style={{ color: "var(--accent)" }}>
              {t("rail:trip.open")}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

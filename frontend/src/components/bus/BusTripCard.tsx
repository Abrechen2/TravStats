import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import { formatAmount } from "../../lib/units";
import type { TripBusJourney } from "../../types/bus";

/** "Kobus · Premium" — whatever of the two is known. */
function serviceOf(ride: TripBusJourney): string | null {
  return [ride.operator, ride.lineName].filter(Boolean).join(" · ") || null;
}

/**
 * A bus ride on the trip timeline (forgejo#180), between the hotels it runs
 * between. Its times are on each terminal's clock — a bus row carries rail's
 * columns, so rail's span formatter reads it as-is. Opens in place, and links
 * to the ride's own page for the rest.
 */
export function BusTripCard({
  ride,
  date,
  dateLabel,
}: {
  ride: TripBusJourney;
  date: string;
  /** The timeline's own label: the terminal's day, not the reader's. */
  dateLabel: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["bus", "trips"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const [open, setOpen] = useState(false);
  const rows: Array<[string, string | null]> = [
    [t("bus:form.operator"), serviceOf(ride)],
    [
      t("bus:form.price"),
      ride.price !== null
        ? formatAmount(ride.price, ride.currency, { language: i18n.language })
        : null,
    ],
  ];
  return (
    <ExpandableEventCard
      icon="🚌"
      bg="color-mix(in srgb, var(--ts-domain-bus) 18%, transparent)"
      iconColor="var(--ts-domain-bus)"
      title={`${ride.depStationName} → ${ride.arrStationName}`}
      subtitle={formatRailSpan(ride, locale, " → ")}
      date={date}
      dateLabel={dateLabel}
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
        to={`/bus/${ride.id}`}
        className="text-xs"
        style={{ color: "var(--accent)" }}
        data-testid="bus-trip-card-open"
      >
        {t("bus:tripCard.open")}
      </Link>
    </ExpandableEventCard>
  );
}

import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import { formatAmount, dateLocaleForLanguage } from "../../lib/units";
import type { TripBusJourney } from "../../types/bus";
import type { TripFerryJourney } from "../../types/ferry";

export type LegTrip = TripBusJourney | TripFerryJourney;

/** What differs between the legs that share this card (bus, ferry). */
export interface LegTripDomain {
  /** i18n namespace and the route segment (`/bus/:id`) alike. */
  ns: "bus" | "ferry";
  icon: string;
  /** Full i18n key of the link to the ride's own page. */
  openKey: string;
  /** "Kobus · Premium" — the operator and the line or vessel, whatever is known. */
  service: (ride: LegTrip) => string | null;
}

/**
 * A bus or ferry ride on the trip timeline (forgejo#180, forgejo#293),
 * between the hotels it runs between. Its times are on each terminal's clock —
 * the ride carries rail's columns, so rail's span formatter reads it as-is.
 * Opens in place, and links to the ride's own page for the rest.
 */
export function LegTripCard({
  domain,
  ride,
  date,
  dateLabel,
}: {
  domain: LegTripDomain;
  ride: LegTrip;
  date: string;
  /** The timeline's own label: the terminal's day, not the reader's. */
  dateLabel: string;
}): JSX.Element {
  const { ns } = domain;
  const { t, i18n } = useTranslation([ns, "trips"]);
  const locale = dateLocaleForLanguage(i18n.language);
  const [open, setOpen] = useState(false);
  const rows: Array<[string, string | null]> = [
    [t(`${ns}:form.operator`), domain.service(ride)],
    [
      t(`${ns}:form.price`),
      ride.price !== null
        ? formatAmount(ride.price, ride.currency, { language: i18n.language })
        : null,
    ],
  ];
  return (
    <ExpandableEventCard
      icon={domain.icon}
      bg={`color-mix(in srgb, var(--ts-domain-${ns}) 18%, transparent)`}
      iconColor={`var(--ts-domain-${ns})`}
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
        to={`/${ns}/${ride.id}`}
        className="text-xs"
        style={{ color: "var(--accent)" }}
        data-testid={`${ns}-trip-card-open`}
      >
        {t(domain.openKey)}
      </Link>
    </ExpandableEventCard>
  );
}

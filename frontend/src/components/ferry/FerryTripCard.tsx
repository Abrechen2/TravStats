/** Ferry crossings (dennis/TravStats forgejo#293). */
import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import { useTranslation } from "../../hooks/useTranslation";
import { formatRailSpan } from "../../lib/railTime";
import { formatAmount, dateLocaleForLanguage } from "../../lib/units";
import type { TripFerryJourney } from "../../types/ferry";

function serviceOf(ride: TripFerryJourney): string | null {
  return [ride.operator, ride.vesselName].filter(Boolean).join(" · ") || null;
}

export function FerryTripCard({
  ride,
  date,
  dateLabel,
}: {
  ride: TripFerryJourney;
  date: string;
  dateLabel: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["ferry", "trips"]);
  const locale = dateLocaleForLanguage(i18n.language);
  const [open, setOpen] = useState(false);
  const rows: Array<[string, string | null]> = [
    [t("ferry:form.operator"), serviceOf(ride)],
    [
      t("ferry:form.price"),
      ride.price !== null
        ? formatAmount(ride.price, ride.currency, { language: i18n.language })
        : null,
    ],
  ];
  return (
    <ExpandableEventCard
      icon="⛴"
      bg="color-mix(in srgb, var(--ts-domain-ferry) 18%, transparent)"
      iconColor="var(--ts-domain-ferry)"
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
        to={`/ferry/${ride.id}`}
        className="text-xs"
        style={{ color: "var(--accent)" }}
        data-testid="ferry-trip-card-open"
      >
        {t("ferry:details")}
      </Link>
    </ExpandableEventCard>
  );
}

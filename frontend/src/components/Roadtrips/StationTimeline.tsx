import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { RoadtripDayTour, RoadtripStation } from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";

const CHIP = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

/**
 * A roadtrip read as the planning mock-up draws it: stations by day, the leg
 * to the next one between them, and on each station the one thing it says
 * about the night — a linked stay, a free night, or a pass-through — plus
 * the day tours that set out from it, the way shore excursions hang off a
 * port on a cruise.
 */
export default function StationTimeline({
  stations,
  legs,
  tours,
  onStartTour,
}: {
  stations: RoadtripStation[];
  legs: TourLeg[];
  tours: RoadtripDayTour[];
  /** Start a day tour from this station; absent = read-only. */
  onStartTour?: (station: RoadtripStation) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "trips"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const legFrom = new Map(legs.map((l) => [l.fromStopId, l]));

  const dateRange = (s: RoadtripStation): string | null => {
    const from = s.startDate ?? s.stay?.checkIn ?? null;
    const to = s.endDate ?? s.stay?.checkOut ?? null;
    if (!from) return null;
    const a = display.date(from, { timeZone: "UTC", omitYear: true });
    return to && to.slice(0, 10) !== from.slice(0, 10)
      ? `${a} – ${display.date(to, { timeZone: "UTC", omitYear: true })}`
      : a;
  };

  if (stations.length === 0) {
    return <p className="text-sm text-(--text-muted)">{t("roadtrips:stations.empty")}</p>;
  }

  return (
    <ol className="space-y-1">
      {stations.map((s, index) => {
        const leg = legFrom.get(s.id);
        const ownTours = tours.filter((tour) => tour.anchorStopId === s.id);
        const when = dateRange(s);
        return (
          <li key={s.id}>
            <div className="grid grid-cols-[4.5rem_1fr] gap-3 py-2">
              <span className="t-meta-mono pt-0.5 text-(--text-muted)">
                {when ?? `#${index + 1}`}
              </span>
              <div className="space-y-1">
                <div className="font-medium">{s.title}</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.state === "stay" && (
                    <Link
                      to={s.stay ? `/lodging/${s.stay.lodgingId}` : "/lodging"}
                      className={CHIP}
                      style={{
                        background: "var(--domain-lodging-soft)",
                        color: "var(--domain-lodging)",
                      }}
                    >
                      {s.stay?.lodgingName ?? t("roadtrips:stay.linked")}
                      {s.stay?.nights != null &&
                        ` · ${t("roadtrips:nightsCount", { count: s.stay.nights })}`}
                    </Link>
                  )}
                  {s.state === "free" && (
                    <span className={CHIP} style={{ background: "var(--bg-surface)" }}>
                      {t("roadtrips:night.free")}
                    </span>
                  )}
                  {s.state === "pass" && (
                    <span
                      className={CHIP}
                      style={{
                        border: "1px dashed var(--color-border)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("roadtrips:night.pass")}
                    </span>
                  )}
                  {ownTours.map((tour) => (
                    <Link
                      key={tour.id}
                      to={`/tours/${tour.id}`}
                      className={CHIP}
                      style={{ background: "var(--domain-tour-soft)", color: "var(--domain-tour)" }}
                    >
                      {tour.activity ? `${t(`roadtrips:activity.${tour.activity}`)} · ` : ""}
                      {tour.name}
                      {tour.distanceKm > 0 && ` · ${nf.format(tour.distanceKm)} km`}
                    </Link>
                  ))}
                  {onStartTour && (
                    <button
                      type="button"
                      onClick={() => onStartTour(s)}
                      className={`${CHIP} border border-dashed border-(--color-border) text-(--text-muted)`}
                    >
                      {t("roadtrips:startTour")}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {leg && index < stations.length - 1 && (
              <div className="ml-[5.25rem] flex items-center gap-2 text-xs text-(--text-muted)">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-5 rounded"
                  style={{
                    background:
                      leg.mode === "ferry" ? "var(--domain-cruise)" : "var(--domain-roadtrip)",
                    opacity: leg.source === "straight" ? 0.5 : 1,
                  }}
                />
                <span className="t-meta-mono">{nf.format(leg.distanceKm)} km</span>
                <span>{t(`trips:tours.mode.${leg.mode}`)}</span>
                {leg.source === "straight" && <span>· {t("roadtrips:legStraight")}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

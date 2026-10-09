import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { dayPlan, type DayLegFacts, type DayPlan } from "../../lib/roadtrip/dayPlan";
import type { RoadtripStation } from "../../types/roadtrip";
import type { LegSource, TourLeg } from "../../types/tour";

/** The order sources are named in: what was measured first, the crow's line last. */
const SOURCE_ORDER: LegSource[] = ["track", "routed", "drawn", "straight"];

/**
 * The compact day view (forgejo#243): one card per travel day — from where,
 * to where, what was passed, where the night was — and the road between with
 * where each kilometre figure comes from. A driving time appears only when
 * every piece of the day's route carries one; otherwise it says it is not
 * known. No arrival time, and no plan from straight lines.
 */
export default function RoadtripDayView({
  stations,
  legs,
  startDate,
}: {
  stations: RoadtripStation[];
  legs: TourLeg[];
  startDate: string | null;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const days = dayPlan(stations, legs, startDate);

  if (days.length === 0) {
    return <p className="t-caption">{t("roadtrips:stations.empty")}</p>;
  }

  const head = (d: DayPlan): string => {
    if (d.day === null) return t("roadtrips:days.undated");
    const date = display.date(`${d.day}T00:00:00Z`, { timeZone: "UTC", weekday: true });
    return d.number !== null ? `${t("roadtrips:timeline.day", { n: d.number })} · ${date}` : date;
  };

  const place = (s: RoadtripStation): string => s.title;

  const route = (facts: DayLegFacts): JSX.Element => {
    const parts = SOURCE_ORDER.flatMap((source) => {
      const km = facts.kmBySource[source];
      return km === undefined ? [] : [t(`roadtrips:days.kmBy.${source}`, { km: nf.format(km) })];
    });
    const ferry = facts.kmByMode.ferry;
    return (
      <div className="flex flex-col" style={{ gap: 2, fontSize: 13 }}>
        <span>
          <span style={{ fontWeight: 700 }}>
            {t("roadtrips:days.km", { km: nf.format(facts.totalKm) })}
          </span>
          {parts.length > 0 && <span className="t-caption"> — {parts.join(" · ")}</span>}
        </span>
        {ferry !== undefined && (
          <span className="t-caption">{t("roadtrips:days.ferry", { km: nf.format(ferry) })}</span>
        )}
        <span className="t-caption" data-testid="day-driving">
          {facts.drivingMinutes !== null
            ? t("roadtrips:days.driving", {
                h: Math.floor(facts.drivingMinutes / 60),
                m: String(facts.drivingMinutes % 60).padStart(2, "0"),
              })
            : t("roadtrips:days.drivingUnknown")}
        </span>
        {facts.missingLeg && (
          <span style={{ color: "var(--ts-warn)" }}>{t("roadtrips:days.missingLeg")}</span>
        )}
      </div>
    );
  };

  return (
    <ol className="flex flex-col" style={{ gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
      {days.map((d) => (
        <li
          key={`${d.day ?? "undated"}-${d.destination.id}`}
          className="flex flex-col"
          style={{
            gap: 8,
            padding: 14,
            borderRadius: "var(--ts-radius-card)",
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
          }}
        >
          <span className="t-label-mono" style={{ color: "var(--domain-roadtrip)" }}>
            {head(d)}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ts-text-bright)" }}>
            {d.start ? `${place(d.start)} → ${place(d.destination)}` : place(d.destination)}
          </span>
          {d.stops.length > 0 && (
            <span className="t-caption">
              {t("roadtrips:days.via", { places: d.stops.map(place).join(", ") })}
            </span>
          )}
          <span style={{ fontSize: 13 }}>
            {d.overnight === null ? (
              <span className="t-caption">{t("roadtrips:days.noNight")}</span>
            ) : (
              <>
                <span className="t-caption">{t("roadtrips:days.night")} </span>
                {d.overnight.station.stay ? (
                  <Link
                    to={`/lodging/${d.overnight.station.stay.lodgingId}`}
                    style={{
                      color: "var(--domain-lodging)",
                      textDecoration: d.overnight.cancelled ? "line-through" : undefined,
                    }}
                  >
                    {d.overnight.station.stay.lodgingName}
                  </Link>
                ) : (
                  <span>{t(`roadtrips:editor.choice.${d.overnight.station.state}.label`)}</span>
                )}
                {" · "}
                {d.overnight.cancelled ? (
                  <span style={{ color: "var(--ts-warn)" }}>
                    {t("roadtrips:timeline.cancelled")}
                  </span>
                ) : d.overnight.nights === null ? (
                  <span style={{ color: "var(--ts-warn)" }}>
                    {t("roadtrips:days.nightsUnknown")}
                  </span>
                ) : (
                  t("roadtrips:nightsCount", { count: d.overnight.nights })
                )}
              </>
            )}
          </span>
          {d.legs && route(d.legs)}
          {d.stayOnDays > 0 && (
            <span className="t-caption">
              {t("roadtrips:days.stayOn", { count: d.stayOnDays, place: place(d.destination) })}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

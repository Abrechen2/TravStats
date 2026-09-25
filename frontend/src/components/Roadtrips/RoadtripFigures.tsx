import type { JSX } from "react";

import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { spanDays } from "../../lib/roadtrip/roadtripView";
import type { RoadtripDetail } from "../../types/roadtrip";

interface Figure {
  key: string;
  label: string;
  value: string;
  sub?: string;
  title?: string;
  hue?: string;
}

/**
 * The figures band of a roadtrip (board 2): driven, days, nights, places
 * slept, countries, day tours — each with the line that says what it is made
 * of. Fixed columns (6 / 3 / 2), so the cells never reflow into an odd last
 * row. A figure that cannot be derived is left out, never drawn as zero.
 */
export default function RoadtripFigures({
  detail,
  today,
}: {
  detail: RoadtripDetail;
  today: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const r = detail.roadtrip;
  const n = detail.nights;
  const days = spanDays(detail.startDate, detail.endDate);
  const end = detail.endDate?.slice(0, 10) ?? null;
  const ahead =
    days !== null && end !== null && end > today
      ? spanDays(`${today}T00:00:00Z`, detail.endDate)
      : null;
  const approx = n.nightsKnown ? "" : "≈ ";

  const figures: Figure[] = [
    {
      key: "driven",
      label: t("roadtrips:detail.figDriven"),
      value: `${nf.format(r.drivenKm)} km`,
      sub:
        r.drivenKm !== r.distanceKm
          ? t("roadtrips:detail.figDrivenSub", { km: nf.format(r.distanceKm) })
          : undefined,
    },
    ...(days !== null
      ? [
          {
            key: "days",
            label: t("roadtrips:detail.figDays"),
            value: nf.format(days),
            sub:
              ahead !== null && ahead > 0
                ? t("roadtrips:detail.figDaysAhead", { count: ahead - 1 })
                : undefined,
          },
        ]
      : []),
    {
      key: "nights",
      label: t("roadtrips:detail.figNights"),
      value: `${approx}${nf.format(n.nights)}`,
      sub: t("roadtrips:detail.figNightsSub", {
        stay: nf.format(n.stayNights),
        free: nf.format(n.freeNights),
      }),
      title: n.nightsKnown ? undefined : t("roadtrips:detail.approxHint"),
    },
    {
      key: "places",
      label: t("roadtrips:detail.figPlaces"),
      value: t("roadtrips:detail.figPlacesValue", { count: n.placesSlept }),
    },
    {
      key: "countries",
      label: t("roadtrips:detail.figCountries"),
      value: nf.format(detail.countries.length),
      sub: detail.countries.join(" · ") || undefined,
    },
    {
      key: "tours",
      label: t("roadtrips:detail.figTours"),
      value: nf.format(detail.tours.length),
      hue: "var(--domain-tour)",
    },
  ];

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <dl
        className="grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6"
        style={{
          gap: 1,
          background: "var(--ts-border)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        {figures.map((f) => (
          <div
            key={f.key}
            className="flex min-w-0 flex-col"
            style={{ background: "var(--ts-surface)", padding: "var(--ts-space-lg)", gap: 4 }}
            title={f.title}
          >
            <dt className="t-label-mono">{f.label}</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--ts-font-mono)",
                fontSize: 22,
                fontWeight: 600,
                color: f.hue ?? "var(--ts-text-bright)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {f.value}
            </dd>
            {f.sub && (
              <dd className="t-caption" style={{ margin: 0 }}>
                {f.sub}
              </dd>
            )}
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center t-caption" style={{ gap: "var(--ts-space-lg)" }}>
        {r.startOdometerKm !== null && (
          <span className="flex items-center" style={{ gap: 6 }}>
            <Icon name="gauge" size={16} />
            {t("roadtrips:detail.odometer", {
              from: nf.format(r.startOdometerKm),
              to:
                r.endOdometerKm !== null
                  ? nf.format(r.endOdometerKm)
                  : t("roadtrips:detail.odometerOpen"),
            })}
          </span>
        )}
        {!n.nightsKnown && <span>{t("roadtrips:detail.approxHint")}</span>}
        {!detail.routingAvailable && <span>{t("roadtrips:detail.noRouting")}</span>}
      </div>
    </div>
  );
}

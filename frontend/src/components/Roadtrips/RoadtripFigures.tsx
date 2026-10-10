import type { JSX } from "react";

import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { distanceFigure } from "../../lib/roadtrip/distanceFigure";
import { daysAhead, spanDays } from "../../lib/roadtrip/roadtripView";
import type { RoadtripDetail } from "../../types/roadtrip";

interface Figure {
  key: string;
  label: string;
  value: string;
  sub?: string;
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
  const ahead = daysAhead(detail.startDate, detail.endDate, today);
  const approx = n.nightsKnown ? "" : "≈ ";

  // The km figure is the length of ALL road legs, whatever their date. What
  // of it is driven comes from the server's timeline rule (`progress`), and
  // "Gefahren" needs a recorded track behind every km (forgejo#179: "Gefahren
  // 254 km" on day 1 of 3, with the only leg still ahead).
  const distance = distanceFigure(r.drivenKm, detail.progress);
  const ferryNote =
    r.drivenKm !== r.distanceKm
      ? t("roadtrips:detail.figDrivenSub", { km: nf.format(r.distanceKm) })
      : undefined;
  const splitNote = distance.split
    ? t("roadtrips:detail.figSoFar", {
        driven: nf.format(distance.split.driven),
        ahead: nf.format(distance.split.ahead),
      })
    : undefined;
  const basisParts = distance.basis
    .map((b) =>
      t("roadtrips:detail.distanceSourceKm", {
        km: nf.format(b.km),
        source: t(`roadtrips:detail.distanceSource.${b.source}`),
      })
    )
    .join(", ");
  // Without the server's split (an older server) the dates say only whether
  // the plan still lies ahead; nothing is called driven.
  const overByDates = days !== null && ahead === null;
  const fallbackNote = overByDates ? undefined : t("roadtrips:detail.figRoutePlanned");
  const stateNote = splitNote ?? (detail.progress ? basisParts || undefined : fallbackNote);

  const figures: Figure[] = [
    {
      key: "driven",
      label:
        distance.label === "driven"
          ? t("roadtrips:detail.figDriven")
          : t("roadtrips:detail.figRoute"),
      value: `${nf.format(r.drivenKm)} km`,
      sub: [stateNote, ferryNote].filter(Boolean).join(" · ") || undefined,
    },
    ...(days !== null
      ? [
          {
            key: "days",
            label: t("roadtrips:detail.figDays"),
            value: nf.format(days),
            sub: ahead !== null ? t("roadtrips:detail.figDaysAhead", { count: ahead }) : undefined,
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
        {basisParts && <span>{t("roadtrips:detail.distanceRule", { parts: basisParts })}</span>}
        {!detail.routingAvailable && <span>{t("roadtrips:detail.noRouting")}</span>}
      </div>
    </div>
  );
}

import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { RangeTotals } from "./trackGeometry";
import { panelStyle } from "./trackMapStyle";

/**
 * The shown span in numbers (TravTrack plan T5.2): distance summed inside the
 * stretches only, time moving, average speed over that time, positions and
 * how much of the span was recorded. A value that cannot be told reads "—",
 * never 0.
 */
export default function TrackTotalsPanel({ totals }: { totals: RangeTotals }): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const minutes = Math.round(totals.movingMs / 60_000);
  const duration =
    minutes >= 60
      ? t("track:map.totals.hours", { h: Math.floor(minutes / 60), m: minutes % 60 })
      : t("track:map.totals.minutes", { m: minutes });
  const rows: Array<[string, string]> = [
    ["distance", t("track:map.totals.km", { km: number(totals.distanceM / 1000, 1) })],
    ["moving", duration],
    [
      "avgSpeed",
      totals.avgKmh === null ? "—" : t("track:map.totals.kmh", { kmh: number(totals.avgKmh, 0) }),
    ],
    ["points", number(totals.points, 0)],
    ["coverage", totals.coverage === null ? "—" : `${number(totals.coverage * 100, 0)} %`],
  ];
  return (
    <section style={panelStyle} aria-label={t("track:map.totals.title")}>
      <h2 className="t-card-title" style={{ marginBottom: 8 }}>
        {t("track:map.totals.title")}
      </h2>
      <dl className="grid grid-cols-2 gap-2" data-testid="track-totals">
        {rows.map(([key, value]) => (
          <div
            key={key}
            style={{ background: "var(--ts-surface2)", borderRadius: 10, padding: 10 }}
            data-total={key}
          >
            <dt className="t-caption">{t(`track:map.totals.${key}`)}</dt>
            <dd style={{ fontSize: 18, fontWeight: 700 }} className="tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="t-caption" style={{ marginTop: 8 }}>
        {t("track:map.totals.note")}
      </p>
    </section>
  );
}

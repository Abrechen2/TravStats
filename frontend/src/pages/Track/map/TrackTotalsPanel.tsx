import { useState } from "react";
import type { JSX } from "react";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import TrackFloatingCard from "./TrackFloatingCard";
import type { RangeTotals } from "./trackGeometry";
import { DASH } from "./trackLegFormat";
import { pillStyle } from "./trackMapStyle";

/** The three figures the card leads with; the rest sits behind „Alle Werte". */
const LEAD = ["distance", "moving", "stops"];

/**
 * „Tag in Zahlen" (TravTrack plan T5.2, web redesign 2026-11-05): distance
 * summed inside the stretches only, time moving and the stops of the loaded
 * days as the lead; „Alle Werte" opens the rest — average and top speed,
 * positions and how much of the span was recorded. A value that cannot be
 * told reads "–", never 0.
 */
export default function TrackTotalsPanel({
  totals,
  stops,
  multi,
  collapsed,
  onToggle,
}: {
  totals: RangeTotals;
  /** Stops of the loaded days; null where the span carries none (a long range). */
  stops: number | null;
  multi: boolean;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const coarse = useCoarsePointer();
  const [all, setAll] = useState(false);
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const minutes = totals.movingMs === null ? null : Math.round(totals.movingMs / 60_000);
  const duration =
    minutes === null
      ? DASH
      : minutes >= 60
        ? t("track:map.totals.hours", { h: Math.floor(minutes / 60), m: minutes % 60 })
        : t("track:map.totals.minutes", { m: minutes });
  const km = t("track:map.totals.km", { km: number(totals.distanceM / 1000, 1) });
  const rows: Array<[string, string]> = [
    ["distance", km],
    ["moving", duration],
    ["stops", stops === null ? DASH : number(stops, 0)],
    [
      "avgSpeed",
      totals.avgKmh === null ? DASH : t("track:map.totals.kmh", { kmh: number(totals.avgKmh, 0) }),
    ],
    // Only with the server's aggregates; the drawing alone cannot tell the fastest reading.
    ...(totals.maxKmh === undefined
      ? []
      : [
          [
            "maxSpeed",
            totals.maxKmh === null
              ? DASH
              : t("track:map.totals.kmh", { kmh: number(totals.maxKmh, 0) }),
          ] as [string, string],
        ]),
    ["points", number(totals.points, 0)],
    ["coverage", totals.coverage === null ? DASH : `${number(totals.coverage * 100, 0)} %`],
  ];
  const shown = all ? rows : rows.filter(([key]) => LEAD.includes(key));
  return (
    <TrackFloatingCard
      testId="track-totals-card"
      title={t(multi ? "track:map.totals.rangeTitle" : "track:map.totals.dayTitle")}
      summary={km}
      collapsed={collapsed}
      onToggle={onToggle}
      coarse={coarse}
    >
      <dl className="grid grid-cols-3 gap-2" data-testid="track-totals">
        {shown.map(([key, value]) => (
          <div
            key={key}
            style={{ background: "var(--ts-surface2)", borderRadius: 10, padding: 8 }}
            data-total={key}
          >
            <dt className="t-caption">{t(`track:map.totals.${key}`)}</dt>
            <dd style={{ fontSize: 16, fontWeight: 700 }} className="tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {all && <p className="t-caption">{t("track:map.totals.note")}</p>}
      <button
        type="button"
        aria-expanded={all}
        data-testid="track-totals-all"
        onClick={() => setAll((open) => !open)}
        style={{ ...pillStyle(false, coarse ? 44 : 36), alignSelf: "flex-start" }}
      >
        {t(all ? "track:map.totals.fewer" : "track:map.totals.all")}
      </button>
    </TrackFloatingCard>
  );
}

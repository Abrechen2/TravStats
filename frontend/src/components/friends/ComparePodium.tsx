import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import { formatMetricValue, type Translate } from "../../lib/comparison/formatMetric";
import { rankPeople, type RankedEntry } from "../../lib/comparison/ranking";
import type { LeaderboardRow } from "../../lib/comparison/types";
import MetricHelp from "./MetricHelp";

interface Props {
  rows: readonly LeaderboardRow[];
  year: number | null;
}

/** Heights of the three steps; the middle of the podium is the winner. */
const STEP_HEIGHT = { 1: 96, 2: 68, 3: 48 } as const;
const ORDER = [2, 1, 3] as const;

/** The top three people per metric — only with three or more participants. */
export default function ComparePodium({ rows, year }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["comparison", "common"]);
  const { colorOf } = useDomainColors();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const [metric, setMetric] = useState<MetricKey>("countries");
  if (rows.length < 3) return null;
  const tr: Translate = (key, options) => String(t(key, options ?? {}));
  const def = LEADERBOARD_METRICS.find((m) => m.key === metric);
  const ranked = rankPeople(rows, metric, year);
  // Ties share a rank, so "the top three" are the entries whose rank is 1, 2 or 3.
  const top = ranked.filter(
    (e): e is RankedEntry & { rank: 1 | 2 | 3 } =>
      e.rank !== null && e.rank <= 3 && e.value !== null
  );
  const color = def?.domain ? colorOf(def.domain) : "var(--ts-accent)";
  const nameOf = (e: RankedEntry): string =>
    e.row.person.kind === "self" ? tr("compare.you") : e.row.person.displayName;
  return (
    <section
      data-testid="compare-podium"
      aria-labelledby="podium-h"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      <div
        className="flex items-center justify-between flex-wrap"
        style={{ gap: "var(--ts-space-md)" }}
      >
        <h3 id="podium-h" className="t-screen-title" style={{ margin: 0 }}>
          {tr("podium.title")}
        </h3>
        <label className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <span className="t-caption">{tr("podium.metric")}</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            data-testid="podium-metric"
          >
            {LEADERBOARD_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {tr(`metric.${m.key}`)}
              </option>
            ))}
          </select>
          <MetricHelp metric={metric} name={tr(`metric.${metric}`)} />
        </label>
      </div>
      {top.length === 0 ? (
        <p className="t-caption" data-testid="podium-empty">
          {tr("podium.nobody")}
        </p>
      ) : (
        <ol
          className="m-0 flex list-none items-end justify-center p-0"
          style={{ gap: "var(--ts-space-md)" }}
        >
          {ORDER.flatMap((place) =>
            top
              .filter((e) => e.rank === place)
              .map((e) => (
                <li
                  key={`${place}-${e.row.person.key}`}
                  data-testid={`podium-${place}`}
                  style={{ textAlign: "center", minWidth: 120 }}
                >
                  <strong>{nameOf(e)}</strong>
                  <div className="t-caption">
                    {e.partial ? "≥ " : ""}
                    {formatMetricValue(e.value as number, def?.unit ?? "count", {
                      distanceUnit,
                      t: tr,
                      language: i18n.language,
                    })}
                  </div>
                  <div
                    style={{
                      height: STEP_HEIGHT[place],
                      background: color,
                      opacity: place === 1 ? 1 : place === 2 ? 0.75 : 0.55,
                      borderRadius: "var(--ts-radius-card) var(--ts-radius-card) 0 0",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "center",
                      paddingTop: 6,
                      color: "var(--ts-bg, #fff)",
                      fontWeight: 700,
                    }}
                  >
                    {tr(`podium.place${place}`)}
                  </div>
                </li>
              ))
          )}
        </ol>
      )}
    </section>
  );
}

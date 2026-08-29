// Stacked-bar chart "Aktivität pro Jahr" — one segment per visible
// domain, summed across enabled domains. The selected year (and the
// compare year if comparison is on) gets a colored outline so the
// chart explains the KPI deltas.
import type { JSX } from "react";
import { useMemo } from "react";
import { DOMAINS, type DomainKey } from "../../../shared/domains";
import type { DomainStatsMap } from "../../../lib/stats/domain-stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { isWithData } from "./aggregate";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { needsOutline } from "../../../lib/domainColor";

interface Props {
  statsMap: DomainStatsMap;
  visible: Partial<Record<DomainKey, boolean>>;
  years: number[];
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
}

interface Series {
  key: DomainKey;
  color: string;
  label: string;
  data: Record<number, number>;
}

export default function CrossDomainActivityChart({
  statsMap,
  visible,
  years,
  selectedYear,
  compareYear,
  compareEnabled,
}: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { colorOf } = useDomainColors();

  const series: Series[] = useMemo(() => {
    const out: Series[] = [];
    for (const [key, stats] of Object.entries(statsMap) as Array<
      [DomainKey, (typeof statsMap)[DomainKey]]
    >) {
      if (!stats || !isWithData(stats)) continue;
      if (visible[key] === false) continue;
      out.push({
        key,
        color: colorOf(key),
        label: t(`common:${DOMAINS[key].i18nKey}`),
        data: stats.yearlyEvents,
      });
    }
    return out;
  }, [statsMap, visible, t]);

  const totals = years.map((y) => series.reduce((s, x) => s + (x.data[y] ?? 0), 0));
  const max = Math.max(1, ...totals);

  const subtitle =
    selectedYear === null
      ? t("stats:overviewChart.subtitleStacked")
      : compareEnabled && compareYear !== null
        ? t("stats:overviewChart.subtitleCompare", { year: selectedYear, compare: compareYear })
        : t("stats:overviewChart.subtitleHighlight", { year: selectedYear });

  return (
    <div
      className="rounded-lg p-6"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overviewChart.title")}
        </h3>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </span>
      </div>
      <div
        className="grid items-end gap-4 mt-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(years.length, 1)}, 1fr)`, height: 240 }}
      >
        {years.map((y, i) => {
          const total = totals[i];
          const isSelected = selectedYear === y;
          const isCompare = compareEnabled && compareYear === y && selectedYear !== null;
          const dimmed = selectedYear !== null && !isSelected && !isCompare;
          return (
            <div key={y} className="flex flex-col items-center gap-2 h-full">
              <div
                className="text-xs font-mono font-semibold"
                style={{ color: dimmed ? "var(--text-muted)" : "var(--text-primary)" }}
              >
                {total}
              </div>
              <div
                className="w-full max-w-16 mx-auto flex flex-col-reverse rounded-sm overflow-hidden flex-1 self-stretch"
                style={{
                  background: "var(--bg-elevated)",
                  opacity: dimmed ? 0.35 : 1,
                  outline: isSelected
                    ? "2px solid var(--accent)"
                    : isCompare
                      ? "2px dashed var(--accent)"
                      : "none",
                  outlineOffset: 2,
                }}
              >
                {series.map((s) => {
                  const v = s.data[y] ?? 0;
                  if (v === 0) return null;
                  return (
                    <div
                      key={s.key}
                      title={`${s.label}: ${v}`}
                      style={{
                        height: `${(v / max) * 100}%`,
                        background: s.color,
                        borderTop: "1px solid rgba(0,0,0,0.2)",
                        // A colour the user picked near the panel's own darkness
                        // stays that colour; it just gets an edge so the bar is
                        // still findable. Brightening it would be overruling a
                        // deliberate choice.
                        outline: needsOutline(s.color) ? "1px solid rgba(255,255,255,0.28)" : undefined,
                        outlineOffset: -1,
                      }}
                    />
                  );
                })}
              </div>
              <div
                className="text-xs font-mono"
                style={{
                  color: isSelected || isCompare ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: isSelected || isCompare ? 700 : 400,
                }}
              >
                {y}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

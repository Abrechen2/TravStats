// Cross-domain "Gesamt" tab orchestrator. Owns the year-filter +
// domain-toggle state, fans them out to the KPI strip, activity chart,
// heatmap, and per-domain summary cards.
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Flight, AchievementSummary } from "../../../types";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../../shared/domains";
import { useDomainStats } from "../../../lib/stats/domain-stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { aggregate, collectYears } from "./aggregate";
import CrossDomainYearFilter from "./CrossDomainYearFilter";
import CrossDomainKpis from "./CrossDomainKpis";
import CrossDomainActivityChart from "./CrossDomainActivityChart";
import CrossDomainHeatmap from "./CrossDomainHeatmap";
import DomainToggleChips from "./DomainToggleChips";
import DomainSummaryCard from "./DomainSummaryCard";

interface Props {
  /** Already filtered to status === "flown" || "historical". */
  flights: Flight[];
  achievements: AchievementSummary | null;
}

export default function OverviewTab({ flights, achievements }: Props): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const { stats, loading } = useDomainStats({ flights });

  const [visible, setVisible] = useState<Partial<Record<DomainKey, boolean>>>(
    () => Object.fromEntries(AVAILABLE_DOMAINS.map((k) => [k, true]))
  );
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [compareYear, setCompareYear] = useState<number | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);

  const years = useMemo(() => collectYears(stats, visible), [stats, visible]);

  // Auto-pick the most recent year once data lands so the year-filter
  // shows real options rather than only "Alle Jahre".
  useEffect(() => {
    if (selectedYear !== null || years.length === 0) return;
    const newest = years[years.length - 1];
    setSelectedYear(newest);
    if (years.length >= 2) {
      setCompareYear(years[years.length - 2]);
      setCompareEnabled(true);
    }
  }, [years, selectedYear]);

  // Defensive: if the user picks a compareYear that's no longer in the
  // year list (e.g. they toggled off the only domain that had that year),
  // fall back to the most recent available alternative.
  useEffect(() => {
    if (compareYear !== null && !years.includes(compareYear)) {
      const fallback = years.find((y) => y !== selectedYear) ?? null;
      setCompareYear(fallback);
      if (fallback === null) setCompareEnabled(false);
    }
  }, [years, compareYear, selectedYear]);

  const agg = aggregate(stats, visible, selectedYear);
  const prevAgg =
    compareEnabled && selectedYear !== null && compareYear !== null
      ? aggregate(stats, visible, compareYear)
      : null;
  const heatmapYear = selectedYear ?? years[years.length - 1] ?? new Date().getFullYear();

  if (loading) {
    return (
      <div className="text-sm py-12 text-center" style={{ color: "var(--text-muted)" }}>
        {t("stats:overview.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          label={t("stats:overview.rangeLabel")}
          hint={t("stats:overview.rangeHint")}
        />
        <CrossDomainYearFilter
          years={years}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          compareYear={compareYear}
          setCompareYear={setCompareYear}
          compareEnabled={compareEnabled}
          setCompareEnabled={setCompareEnabled}
        />
      </section>

      <section>
        <SectionHeader
          label={t("stats:overview.kpisLabel")}
          hint={kpiScopeHint(selectedYear, compareYear, compareEnabled, t)}
        />
        <CrossDomainKpis
          agg={agg}
          prevAgg={prevAgg}
          selectedYear={selectedYear}
          compareYear={compareYear}
          compareEnabled={compareEnabled}
          achievements={achievements}
        />
      </section>

      <section>
        <SectionHeader
          label={t("stats:overview.activityLabel")}
          hint={t("stats:overview.activityHint")}
        />
        <DomainToggleChips visible={visible} setVisible={setVisible} statsMap={stats} />
        <CrossDomainActivityChart
          statsMap={stats}
          visible={visible}
          years={years}
          selectedYear={selectedYear}
          compareYear={compareYear}
          compareEnabled={compareEnabled}
        />
      </section>

      <section>
        <CrossDomainHeatmap statsMap={stats} visible={visible} year={heatmapYear} />
      </section>

      <section>
        <SectionHeader
          label={t("stats:overview.perDomainLabel")}
          hint={
            selectedYear !== null
              ? t("stats:overview.perDomainHintScoped", { year: selectedYear })
              : t("stats:overview.perDomainHint")
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {AVAILABLE_DOMAINS.map((key) => (
            <DomainSummaryCard
              key={key}
              domain={key}
              stats={stats[key]}
              selectedYear={selectedYear}
              compareYear={compareYear}
              compareEnabled={compareEnabled}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ label, hint }: { label: string; hint?: string }): JSX.Element {
  return (
    <div
      className="flex items-baseline gap-3 mb-3"
      style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 8 }}
    >
      <span
        className="text-xs uppercase tracking-widest font-semibold"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      {hint && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function kpiScopeHint(
  selectedYear: number | null,
  compareYear: number | null,
  compareEnabled: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (selectedYear === null) return t("stats:overview.scopeLifetime");
  if (compareEnabled && compareYear !== null)
    return t("stats:overview.scopeCompare", { year: selectedYear, compare: compareYear });
  return t("stats:overview.scopeYear", { year: selectedYear });
}

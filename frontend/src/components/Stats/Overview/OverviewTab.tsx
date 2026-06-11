// Cross-domain "Gesamt" tab orchestrator. Owns the year-filter +
// domain-toggle state, fans them out to the KPI strip, activity chart,
// heatmap, and per-domain summary cards.
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Flight, AchievementSummary } from "../../../types";
import type { DomainKey } from "../../../shared/domains";
import { useDomainStats } from "../../../lib/stats/domain-stats";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
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
  // Domain-gating: the overview only ever renders the user's enabled
  // domains — toggle chips, summary cards, and aggregate inputs alike.
  // useDomainStats applies the same filter to its fetches, so `stats`
  // never contains a disabled domain either.
  const { enabled } = useEnabledDomains();
  const { stats, loading } = useDomainStats({ flights });

  const [visible, setVisible] = useState<Partial<Record<DomainKey, boolean>>>(
    () => Object.fromEntries(enabled.map((k) => [k, true]))
  );
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [compareYear, setCompareYear] = useState<number | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [didAutoPick, setDidAutoPick] = useState(false);

  const years = useMemo(() => collectYears(stats, visible), [stats, visible]);

  // Auto-pick the most recent year ONCE after data lands. After that, the
  // user owns selectedYear — clicking "Alle Jahre" must not snap back.
  useEffect(() => {
    if (didAutoPick || years.length === 0) return;
    setSelectedYear(years[years.length - 1]);
    if (years.length >= 2) {
      setCompareYear(years[years.length - 2]);
      setCompareEnabled(true);
    }
    setDidAutoPick(true);
  }, [years, didAutoPick]);

  // Defensive: keep compareYear in a valid state. Two collapse cases:
  //  1. The compare year disappeared from the dataset (e.g. user toggled
  //     off the only domain that had data for it).
  //  2. The user picked compareYear == selectedYear — the delta would
  //     read 0 against itself.
  useEffect(() => {
    if (compareYear === null) return;
    const stale = !years.includes(compareYear) || compareYear === selectedYear;
    if (!stale) return;
    const fallback = pickAdjacentYear(years, selectedYear);
    setCompareYear(fallback);
    if (fallback === null) setCompareEnabled(false);
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
        <DomainToggleChips
          domains={enabled}
          visible={visible}
          setVisible={setVisible}
          statsMap={stats}
        />
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
          {enabled.map((key) => (
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

/**
 * Pick the chronologically closest year to `current` from `years`,
 * skipping `current` itself. Ties prefer the older year so the user
 * lands on a "year-over-year change" comparison by default.
 */
function pickAdjacentYear(years: number[], current: number | null): number | null {
  const candidates = years.filter((y) => y !== current);
  if (candidates.length === 0) return null;
  if (current === null) return candidates[candidates.length - 1];
  let best = candidates[0];
  let bestDist = Math.abs(best - current);
  for (const y of candidates) {
    const d = Math.abs(y - current);
    if (d < bestDist || (d === bestDist && y < best)) {
      best = y;
      bestDist = d;
    }
  }
  return best;
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

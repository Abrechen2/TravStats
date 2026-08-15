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
import { useStatsCompareStore } from "../../../store/statsCompareStore";
import { aggregate, collectYears, resolveStaleCompareYear } from "./aggregate";
import CrossDomainYearFilter from "./CrossDomainYearFilter";
import CrossDomainKpis from "./CrossDomainKpis";
import CrossDomainActivityChart from "./CrossDomainActivityChart";
import CrossDomainHeatmap from "./CrossDomainHeatmap";
import DomainToggleChips from "./DomainToggleChips";
import DomainSummaryCard from "./DomainSummaryCard";
import TravelAccountSection from "./TravelAccountSection";

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

  const [visible, setVisible] = useState<Partial<Record<DomainKey, boolean>>>(() =>
    Object.fromEntries(enabled.map((k) => [k, true]))
  );
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [didAutoPick, setDidAutoPick] = useState(false);

  // compareEnabled / compareYear are persisted (issue #188) — once the
  // user picks a year or flips the toggle, that choice survives a page
  // revisit instead of silently resetting. `hasSetPreference` gates the
  // auto-pick default below so a brand-new user still gets the same
  // "comparison ON by default" behaviour as before, exactly once.
  const compareYear = useStatsCompareStore((s) => s.compareYear);
  const compareEnabled = useStatsCompareStore((s) => s.compareEnabled);
  const hasSetComparePreference = useStatsCompareStore((s) => s.hasSetPreference);
  const setCompareYear = useStatsCompareStore((s) => s.setCompareYear);
  const setCompareEnabled = useStatsCompareStore((s) => s.setCompareEnabled);
  const setCompare = useStatsCompareStore((s) => s.setCompare);

  const years = useMemo(() => collectYears(stats, visible), [stats, visible]);

  // Auto-pick the most recent year ONCE after data lands. After that, the
  // user owns selectedYear — clicking "Alle Jahre" must not snap back.
  // The compare toggle/year only get auto-picked while the user has never
  // set an explicit preference (see statsCompareStore) — once they have,
  // even "off" must stick.
  useEffect(() => {
    if (didAutoPick || years.length === 0) return;
    setSelectedYear(years[years.length - 1]);
    if (!hasSetComparePreference && years.length >= 2) {
      setCompare(true, years[years.length - 2]);
    }
    setDidAutoPick(true);
  }, [years, didAutoPick, hasSetComparePreference, setCompare]);

  // Defensive: keep compareYear in a valid state. Three collapse cases:
  //  1. The compare year disappeared from the dataset (e.g. user toggled
  //     off the only domain that had data for it, deleted those trips,
  //     or a persisted year from a previous session no longer exists).
  //  2. The user picked compareYear == selectedYear — the delta would
  //     read 0 against itself.
  //  3. Fewer than 2 years of data exist at all (e.g. a fresh install
  //     with a persisted compareEnabled: true from a different dataset)
  //     — there's nothing left to fall back to, so comparison turns off
  //     rather than rendering against a year with no data.
  //
  // Must NOT run before the data has actually loaded: while `loading` is
  // true (or on a genuinely data-free account) `years` is `[]`, which
  // makes every persisted compareYear look "stale" and would wipe the
  // user's saved preference (issue #188 regression) before it ever had a
  // chance to be judged against the real year list. Wait for data; if
  // there truly is none, leave the persisted preference untouched — there
  // is simply nothing to render a comparison against yet.
  useEffect(() => {
    if (loading || years.length === 0) return;
    const resolution = resolveStaleCompareYear(years, selectedYear, compareYear);
    if (!resolution) return;
    setCompareYear(resolution.compareYear);
    if (resolution.disableCompare) setCompareEnabled(false);
  }, [loading, years, compareYear, selectedYear, setCompareYear, setCompareEnabled]);

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

      {/* The cross-domain night account. Fetches on its own rather than
          joining useDomainStats: it is one request answering a question none
          of the per-domain adapters can, and a failure in it must not take
          the rest of the overview down. */}
      <TravelAccountSection />
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

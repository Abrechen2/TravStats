// Cross-domain "Gesamt" tab orchestrator. Fans the page's period and its own
// domain toggles out to the KPI strip, activity chart, heatmap, and per-domain
// summary cards. The period itself belongs to the page (`useStatsPeriod`),
// because every tab has to answer for the same year.
import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { AchievementSummary } from "../../../types";
import type { DomainKey } from "../../../shared/domains";
import type { DomainStatsMap } from "../../../lib/stats/domain-stats";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { usePlacesAccess } from "../../../hooks/usePlacesVisible";
import { visibleStatsTabs } from "../../../pages/statsTabAccess";
import { useTranslation } from "../../../hooks/useTranslation";
import type { StatsPeriod } from "../useStatsPeriod";
import { aggregate, collectYears } from "./aggregate";
import CrossDomainKpis from "./CrossDomainKpis";
import CrossDomainActivityChart from "./CrossDomainActivityChart";
import CrossDomainHeatmap from "./CrossDomainHeatmap";
import DomainToggleChips from "./DomainToggleChips";
import DomainSummaryCard from "./DomainSummaryCard";
import TravelAccountSection from "./TravelAccountSection";

interface Props {
  /** From the page's `useDomainStats` — already limited to enabled domains. */
  stats: DomainStatsMap;
  loading: boolean;
  period: StatsPeriod;
  achievements: AchievementSummary | null;
}

export default function OverviewTab({ stats, loading, period, achievements }: Props): JSX.Element {
  const { t } = useTranslation(["stats"]);
  // Domain-gating: the overview only ever renders the user's enabled
  // domains — toggle chips, summary cards, and aggregate inputs alike.
  // useDomainStats applies the same filter to its fetches, so `stats`
  // never contains a disabled domain either.
  //
  // POI is asked a second question: is the INSTANCE allowed to show it? The
  // tab strip and the deep link both ask it; until 2026-09-05 this overview
  // did not, and drew a "POI / Besuche" chip and card on an instance with the
  // beta flag off for an account that had the domain on from beta days.
  const { enabled: enabledDomains } = useEnabledDomains();
  const placesAccess = usePlacesAccess();
  const enabled = useMemo(
    () => visibleStatsTabs(enabledDomains, placesAccess),
    [enabledDomains, placesAccess]
  );
  const { selectedYear, compareYear, compareEnabled } = period;

  const [visible, setVisible] = useState<Partial<Record<DomainKey, boolean>>>(() =>
    Object.fromEntries(enabled.map((k) => [k, true]))
  );

  // The chart's x-axis follows the domain chips; the period bar does not. A
  // chip switched off hides a series, it does not take a year off the page.
  const years = useMemo(() => collectYears(stats, visible), [stats, visible]);

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

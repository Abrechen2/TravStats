import type { SummaryStats } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonWindow } from "../../lib/stats/comparisonWindow";
import { useSettingsStore } from "../../store/settingsStore";
import {
  convertDistance,
  formatCurrency,
  formatHoursValue,
  getDistanceLabel,
} from "../../lib/units";
import TrendDelta from "./TrendDelta";
import EvidenceTrigger from "./EvidenceTrigger";
import type { EvidenceScopeParams } from "../evidence/useEvidence";

interface FlightYearSummaryCardsProps {
  selectedYear: number | null;
  compareYear: number | null;
  summaryLoading: boolean;
  yearSummary: SummaryStats | null;
  compareSummary: SummaryStats | null;
}

/**
 * The flight tab's four year-scoped tiles.
 *
 * This file was `StatsYearFilter` and carried its own year `<select>` and
 * compare toggle, separate from the overview's. The period now has one control
 * for the whole page (`StatsPeriodBar`), so what was left here was the tiles —
 * and a component named "YearFilter" that no longer filters would be a lie.
 */
export default function FlightYearSummaryCards({
  selectedYear,
  compareYear,
  summaryLoading,
  yearSummary,
  compareSummary,
}: FlightYearSummaryCardsProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const { units, baseCurrency } = useSettingsStore();
  const formatHours = (minutes: number): string => formatHoursValue(minutes / 60, i18n.language);
  // `year`-scoped measures need the year itself, not just the "year" period
  // kind — an evidence request without it is a request the resolver cannot
  // answer. `selectedYear` is non-null whenever this block renders anything
  // (`yearSummary !== null` implies it — see `useUrlStatsPeriod`).
  const yearScope: EvidenceScopeParams | undefined =
    selectedYear !== null ? { period: "year", year: selectedYear } : undefined;
  // These summaries are per-year totals the server computed, so this tab
  // cannot cut a still-running year at today the way the Gesamt tab cuts its
  // day-keyed adapters. It asks the same rule whether the year is over and
  // labels the comparison for what it is — a part year against a whole one —
  // rather than printing a bare "vs 2025" over it.
  // Both years, because the compare year can be the later, still-running one.
  const runningYear =
    selectedYear === null ? null : comparisonWindow(selectedYear, compareYear).runningYear;
  const vsKey = runningYear !== null ? "stats:yearFilter.vsFullYear" : "stats:yearFilter.vs";

  return (
    <>
      {summaryLoading && yearSummary === null && (
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          {t("stats:loading")}
        </p>
      )}

      {/* Year-Filtered Summary Cards */}
      {yearSummary !== null && (
        <>
          {/* Header that makes it unambiguous these are year-scoped numbers */}
          <div
            className="flex items-baseline gap-3 mb-3 mt-2"
            style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "8px" }}
          >
            <span
              className="text-xs uppercase tracking-widest font-semibold"
              style={{ color: "var(--accent)" }}
            >
              {t("stats:yearFilter.scopeLabel", { year: selectedYear })}
            </span>
            {compareSummary !== null && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t(vsKey, { year: compareYear })}
              </span>
            )}
          </div>
          {compareSummary !== null && runningYear !== null && (
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              {t("stats:yearFilter.partialYearNote", { year: runningYear })}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Total Flights */}
            <EvidenceTrigger
              kind="metric"
              evidenceKey="yearFlightCount"
              scope={yearScope}
              renderedValue={yearSummary.totalFlights}
              label={t("stats:overview.totalFlights")}
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalFlights")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t(vsKey, { year: compareYear })}
                  </span>
                )}
              </h3>
              <div className="flex items-end gap-2 mt-2">
                <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {yearSummary.totalFlights}
                </p>
                {compareSummary !== null && (
                  <TrendDelta
                    current={yearSummary.totalFlights}
                    previous={compareSummary.totalFlights}
                  />
                )}
              </div>
              {compareSummary !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {compareSummary.totalFlights} ({compareYear})
                </p>
              )}
            </EvidenceTrigger>

            {/* Total Distance */}
            <EvidenceTrigger
              kind="metric"
              evidenceKey="yearDistanceKm"
              scope={yearScope}
              renderedValue={yearSummary.totalDistance}
              label={t("stats:overview.totalDistance")}
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalDistance")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t(vsKey, { year: compareYear })}
                  </span>
                )}
              </h3>
              <div className="flex items-end gap-2 mt-2">
                <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {convertDistance(yearSummary.totalDistance, units.distanceUnit)
                    .toFixed(0)
                    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                  <span className="text-lg ml-1">{getDistanceLabel(units.distanceUnit, t)}</span>
                </p>
                {compareSummary !== null && (
                  <TrendDelta
                    current={yearSummary.totalDistance}
                    previous={compareSummary.totalDistance}
                  />
                )}
              </div>
              {compareSummary !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {convertDistance(compareSummary.totalDistance, units.distanceUnit).toFixed(0)}{" "}
                  {getDistanceLabel(units.distanceUnit, t)} ({compareYear})
                </p>
              )}
            </EvidenceTrigger>

            {/* Total Flight Time */}
            <EvidenceTrigger
              kind="metric"
              evidenceKey="yearFlightTimeMinutes"
              scope={yearScope}
              renderedValue={yearSummary.totalFlightTime}
              label={t("stats:overview.totalFlightTime")}
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalFlightTime")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t(vsKey, { year: compareYear })}
                  </span>
                )}
              </h3>
              <div className="flex items-end gap-2 mt-2">
                <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {formatHours(yearSummary.totalFlightTime)}
                  <span className="text-lg ml-1">{t("stats:overview.hours")}</span>
                </p>
                {compareSummary !== null && (
                  <TrendDelta
                    current={yearSummary.totalFlightTime}
                    previous={compareSummary.totalFlightTime}
                  />
                )}
              </div>
              {compareSummary !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {formatHours(compareSummary.totalFlightTime)} {t("stats:overview.hours")} (
                  {compareYear})
                </p>
              )}
            </EvidenceTrigger>

            {/* Total Cost */}
            <EvidenceTrigger
              kind="metric"
              evidenceKey="yearTotalCost"
              scope={yearScope}
              renderedValue={yearSummary.totalCost}
              label={t("stats:overview.totalCost")}
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalCost")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t(vsKey, { year: compareYear })}
                  </span>
                )}
              </h3>
              <div className="flex items-end gap-2 mt-2">
                <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {/* Null is "nothing recorded", not "free" (forgejo#83) — a dash, never 0 €. */}
                  {yearSummary.totalCost === null
                    ? "—"
                    : formatCurrency(yearSummary.totalCost, baseCurrency)}
                </p>
                {compareSummary !== null &&
                  yearSummary.totalCost !== null &&
                  compareSummary.totalCost !== null && (
                    <TrendDelta
                      current={yearSummary.totalCost}
                      previous={compareSummary.totalCost}
                    />
                  )}
              </div>
              {yearSummary.totalCost === null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {t("stats:overview.noPricesRecorded", { count: yearSummary.unpricedFlights })}
                </p>
              )}
              {compareSummary !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {compareSummary.totalCost === null
                    ? "—"
                    : formatCurrency(compareSummary.totalCost, baseCurrency)}{" "}
                  ({compareYear})
                </p>
              )}
            </EvidenceTrigger>
          </div>
        </>
      )}
    </>
  );
}

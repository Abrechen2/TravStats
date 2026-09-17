import type { SummaryStats } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { convertDistance, formatCurrency, getDistanceLabel } from "../../lib/units";
import TrendDelta from "./TrendDelta";

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
  // Same rule as the overview card: one decimal, in the reader's language.
  // `toFixed(1)` printed "1.5" on a German page beside a card that said "2 h"
  // for the same flight (CT106 design-6 R09).
  const hoursLocale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const formatHours = (minutes: number): string =>
    (minutes / 60).toLocaleString(hoursLocale, { maximumFractionDigits: 1 });

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
                {t("stats:yearFilter.vs", { year: compareYear })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Total Flights */}
            <div
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalFlights")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("stats:yearFilter.vs", { year: compareYear })}
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
            </div>

            {/* Total Distance */}
            <div
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalDistance")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("stats:yearFilter.vs", { year: compareYear })}
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
            </div>

            {/* Total Flight Time */}
            <div
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalFlightTime")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("stats:yearFilter.vs", { year: compareYear })}
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
            </div>

            {/* Total Cost */}
            <div
              className="rounded-lg shadow-sm p-6"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:overview.totalCost")}
                {compareSummary !== null && (
                  <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("stats:yearFilter.vs", { year: compareYear })}
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
            </div>
          </div>
        </>
      )}
    </>
  );
}

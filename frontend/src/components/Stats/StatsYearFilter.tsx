import type { SummaryStats } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { convertDistance, formatCurrency, getDistanceLabel } from "../../lib/units";
import TrendDelta from "./TrendDelta";

interface StatsYearFilterProps {
  availableYears: number[];
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
  summaryLoading: boolean;
  yearSummary: SummaryStats | null;
  compareSummary: SummaryStats | null;
  onSelectedYearChange: (year: number | null) => void;
  onCompareYearChange: (year: number | null) => void;
  onCompareEnabledChange: (enabled: boolean) => void;
}

export default function StatsYearFilter({
  availableYears,
  selectedYear,
  compareYear,
  compareEnabled,
  summaryLoading,
  yearSummary,
  compareSummary,
  onSelectedYearChange,
  onCompareYearChange,
  onCompareEnabledChange,
}: StatsYearFilterProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const { units, baseCurrency } = useSettingsStore();

  return (
    <>
      {/* Year Filter Controls */}
      {availableYears.length > 0 && (
        <div
          className="rounded-lg shadow-sm p-4 mb-6 flex flex-wrap items-center gap-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <label
              htmlFor="year-select"
              className="text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {t("stats:yearFilter.selectYear")}
            </label>
            <select
              id="year-select"
              value={selectedYear ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  onSelectedYearChange(null);
                  onCompareEnabledChange(false);
                  onCompareYearChange(null);
                } else {
                  onSelectedYearChange(Number(val));
                }
              }}
              className="rounded-sm border px-2 py-1 text-sm"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--color-border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">{t("stats:yearFilter.allTime")}</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          {selectedYear !== null && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={compareEnabled}
                onChange={(e) => {
                  onCompareEnabledChange(e.target.checked);
                  if (!e.target.checked) {
                    onCompareYearChange(null);
                  }
                }}
                className="rounded-sm"
              />
              <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {t("stats:yearFilter.compareWith")}
              </span>
            </label>
          )}

          {selectedYear !== null && compareEnabled && (
            <select
              value={compareYear ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onCompareYearChange(val === "" ? null : Number(val));
              }}
              className="rounded-sm border px-2 py-1 text-sm"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--color-border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">—</option>
              {availableYears
                .filter((yr) => yr !== selectedYear)
                .map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
            </select>
          )}

          {summaryLoading && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:loading")}
            </span>
          )}
        </div>
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
                  {(yearSummary.totalFlightTime / 60).toFixed(1)}
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
                  {(compareSummary.totalFlightTime / 60).toFixed(1)} {t("stats:overview.hours")} (
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
                  {formatCurrency(yearSummary.totalCost, baseCurrency)}
                </p>
                {compareSummary !== null && (
                  <TrendDelta current={yearSummary.totalCost} previous={compareSummary.totalCost} />
                )}
              </div>
              {compareSummary !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {formatCurrency(compareSummary.totalCost, baseCurrency)} ({compareYear})
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

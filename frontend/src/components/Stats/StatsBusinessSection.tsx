import type { BusinessStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatCurrency, formatDistance, formatHours, formatHoursValue } from "../../lib/units";
import EvidenceTrigger from "./EvidenceTrigger";
import CountingHelp from "./counting/CountingHelp";
import { rankingKey } from "../../shared/evidence";

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const as readonly string[];

interface StatsBusinessSectionProps {
  businessStats: BusinessStats;
}

export default function StatsBusinessSection({
  businessStats,
}: StatsBusinessSectionProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const { units, baseCurrency } = useSettingsStore();
  const lang = i18n.language;
  // The server names the month in English ("Mar"); the reader's language does.
  const monthIndex = businessStats.busiestMonth
    ? MONTH_KEYS.indexOf(businessStats.busiestMonth.toLowerCase())
    : -1;
  const busiestMonth =
    monthIndex >= 0 ? t(`stats:months.${MONTH_KEYS[monthIndex]}`) : businessStats.busiestMonth;

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:business.title")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* A rate opens the priced flights its cost is the sum of. */}
        <EvidenceTrigger
          kind="metric"
          evidenceKey="businessTotalCost"
          scope={{ period: "allTime" }}
          renderedValue={null}
          label={t("stats:business.costPerKm")}
          className="rounded-lg shadow-sm p-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.costPerKm")}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {businessStats.costPerKm === null
              ? "—"
              : formatCurrency(businessStats.costPerKm, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {businessStats.costPerKm === null
              ? t("stats:business.noPricesRecorded")
              : t("stats:business.costPerKmDesc", {
                  cost: formatCurrency(businessStats.costPerKm, baseCurrency),
                })}
          </p>
        </EvidenceTrigger>

        {/* Same priced flights as the rate per kilometre. */}
        <EvidenceTrigger
          kind="metric"
          evidenceKey="businessTotalCost"
          scope={{ period: "allTime" }}
          renderedValue={null}
          label={t("stats:business.costPerHour")}
          className="rounded-lg shadow-sm p-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.costPerHour")}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {businessStats.costPerHour === null
              ? "—"
              : formatCurrency(businessStats.costPerHour, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {businessStats.costPerHour === null
              ? t("stats:business.noPricesRecorded")
              : t("stats:business.costPerHourDesc", {
                  cost: formatCurrency(businessStats.costPerHour, baseCurrency),
                })}
          </p>
        </EvidenceTrigger>

        <EvidenceTrigger
          kind="metric"
          evidenceKey="businessTotalCost"
          scope={{ period: "allTime" }}
          renderedValue={businessStats.totalCost}
          label={t("stats:business.totalCost")}
          className="rounded-lg shadow-sm p-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.totalCost")}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {/* Null is "nothing recorded", not "free" (forgejo#83). */}
            {businessStats.totalCost === null
              ? "—"
              : formatCurrency(businessStats.totalCost, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {businessStats.totalCost === null
              ? t("stats:business.noPricesRecorded")
              : t("stats:business.totalCostDesc", {
                  cost: formatCurrency(businessStats.totalCost, baseCurrency),
                  distance: formatDistance(
                    businessStats.totalDistance,
                    units.distanceUnit,
                    t,
                    lang
                  ),
                })}
          </p>
        </EvidenceTrigger>

        <EvidenceTrigger
          kind="metric"
          evidenceKey="airportsVisitedCount"
          scope={{ period: "allTime" }}
          renderedValue={businessStats.airportDiversity}
          label={t("stats:business.airportDiversity")}
          className="rounded-lg shadow-sm p-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.airportDiversity")}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {businessStats.airportDiversity}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.airportDiversityDesc", {
              count: businessStats.airportDiversity,
            })}
          </p>
        </EvidenceTrigger>

        <div
          className="rounded-lg shadow-sm p-6"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.avgFlightDuration")}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            {businessStats.avgFlightDuration === null
              ? "—"
              : formatHours(businessStats.avgFlightDuration, lang)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {businessStats.avgFlightDuration !== null &&
              t("stats:business.avgFlightDurationDesc", {
                hours: formatHoursValue(businessStats.avgFlightDuration, lang),
              })}
          </p>
        </div>

        {businessStats.busiestMonth && monthIndex >= 0 && (
          // The month's bar of the seasonal chart: the same countable flights
          // on the same departure clock (`departureMonth`).
          <EvidenceTrigger
            kind="ranking"
            evidenceKey={rankingKey("departureMonth", String(monthIndex + 1))}
            scope={{ period: "allTime" }}
            renderedValue={businessStats.busiestMonthFlights}
            label={t("stats:business.busiestMonth")}
            className="rounded-lg shadow-sm p-6"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              {t("stats:business.busiestMonth")}
            </h3>
            <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
              {busiestMonth}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {t("stats:business.busiestMonthDesc", {
                month: busiestMonth,
                count: businessStats.busiestMonthFlights,
              })}
            </p>
          </EvidenceTrigger>
        )}

        {businessStats.mostCommonCategory && (
          <div
            className="rounded-lg shadow-sm p-6"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              {t("stats:business.mostCommonCategory")}
            </h3>
            <p className="text-3xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
              {businessStats.mostCommonCategory}
            </p>
          </div>
        )}

        {Object.keys(businessStats.seatClassDistribution).length > 0 && (
          <div
            className="rounded-lg shadow-sm p-6 col-span-1 md:col-span-2 lg:col-span-3"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:business.seatClassDistribution")}
            </h3>
            <div className="space-y-2">
              {Object.entries(businessStats.seatClassDistribution).map(
                ([seatClass, percentage]) => (
                  <div key={seatClass} className="flex items-center justify-between">
                    <span className="capitalize" style={{ color: "var(--text-muted)" }}>
                      {seatClass.replace("_", " ")}
                    </span>
                    <div className="flex items-center gap-4">
                      <div
                        className="w-32 rounded-full h-2"
                        style={{ background: "var(--bg-muted)" }}
                      >
                        <div
                          className="h-2 rounded-full"
                          style={{ background: "var(--accent)", width: `${percentage}%` }}
                        />
                      </div>
                      <span
                        className="text-sm font-semibold w-12 text-right"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {percentage}%
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
      <CountingHelp
        testId="business-counting-help"
        entries={[
          { term: t("stats:business.costPerKm"), helpKey: "flightStatsHelp:business.costPerKm" },
          {
            term: t("stats:business.costPerHour"),
            helpKey: "flightStatsHelp:business.costPerHour",
          },
          { term: t("stats:business.totalCost"), helpKey: "flightStatsHelp:business.totalCost" },
          {
            term: t("stats:business.airportDiversity"),
            helpKey: "flightStatsHelp:business.airportDiversity",
          },
          {
            term: t("stats:business.avgFlightDuration"),
            helpKey: "flightStatsHelp:business.avgDuration",
          },
          {
            term: t("stats:business.busiestMonth"),
            helpKey: "flightStatsHelp:business.busiestMonth",
          },
          {
            term: t("stats:business.mostCommonCategory"),
            helpKey: "flightStatsHelp:business.category",
          },
          {
            term: t("stats:business.seatClassDistribution"),
            helpKey: "flightStatsHelp:business.seatClassShare",
          },
        ]}
      />
    </div>
  );
}

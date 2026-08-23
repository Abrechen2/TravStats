import type { BusinessStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatCurrency, formatDistance } from "../../lib/units";

interface StatsBusinessSectionProps {
  businessStats: BusinessStats;
}

export default function StatsBusinessSection({
  businessStats,
}: StatsBusinessSectionProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const { units, baseCurrency } = useSettingsStore();
  const lang = i18n.language;

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:business.title")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
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
            {formatCurrency(businessStats.costPerKm, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.costPerKmDesc", {
              cost: businessStats.costPerKm.toFixed(2),
            })}
          </p>
        </div>

        <div
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
            {formatCurrency(businessStats.costPerHour, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.costPerHourDesc", {
              cost: businessStats.costPerHour.toFixed(2),
            })}
          </p>
        </div>

        <div
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
            {formatCurrency(businessStats.totalCost, baseCurrency)}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.totalCostDesc", {
              cost: businessStats.totalCost.toLocaleString(),
              distance: formatDistance(businessStats.totalDistance, units.distanceUnit, t, lang),
            })}
          </p>
        </div>

        <div
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
        </div>

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
            {businessStats.avgFlightDuration.toFixed(1)}h
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {t("stats:business.avgFlightDurationDesc", {
              hours: businessStats.avgFlightDuration.toFixed(1),
            })}
          </p>
        </div>

        {businessStats.busiestMonth && (
          <div
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
              {businessStats.busiestMonth}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {t("stats:business.busiestMonthDesc", {
                month: businessStats.busiestMonth,
                count: businessStats.busiestMonthFlights,
              })}
            </p>
          </div>
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
    </div>
  );
}

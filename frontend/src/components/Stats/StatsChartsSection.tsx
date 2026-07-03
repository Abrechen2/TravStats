import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "../../hooks/useTranslation";

interface SeasonalDataPoint {
  month: string;
  flights: number;
}

interface WeekdayDataPoint {
  day: string;
  flights: number;
}

interface StatsChartsSectionProps {
  seasonalData: SeasonalDataPoint[];
  weekdayData: WeekdayDataPoint[];
  hasFlights: boolean;
}

export default function StatsChartsSection({
  seasonalData,
  weekdayData,
  hasFlights,
}: StatsChartsSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  return (
    <div className="mb-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:timeBasedAnalytics.title")}
      </h2>

      {/* Seasonal Patterns and Weekday Analysis */}
      {hasFlights && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Seasonal Pattern */}
          <div
            className="rounded-lg shadow-lg p-6"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:timeBasedAnalytics.seasonalPatterns")}
            </h3>
            {seasonalData.some((d) => d.flights > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={seasonalData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="month"
                    stroke="var(--text-muted)"
                    tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--text-muted)"
                    tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      color: "var(--text-primary)",
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="flights"
                    fill="var(--accent)"
                    radius={[4, 4, 0, 0]}
                    name={t("stats:timeBasedAnalytics.flightsLabel")}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="flex items-center justify-center h-[300px]"
                style={{ color: "var(--text-muted)" }}
              >
                <p>{t("stats:timeBasedAnalytics.noData")}</p>
              </div>
            )}
          </div>

          {/* Weekday Analysis */}
          <div
            className="rounded-lg shadow-lg p-6"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("stats:timeBasedAnalytics.weekdayAnalysis")}
            </h3>
            {weekdayData.some((d) => d.flights > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weekdayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="day"
                    stroke="var(--text-muted)"
                    tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--text-muted)"
                    tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      color: "var(--text-primary)",
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="flights"
                    fill="var(--success)"
                    radius={[4, 4, 0, 0]}
                    name={t("stats:timeBasedAnalytics.flightsLabel")}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="flex items-center justify-center h-[300px]"
                style={{ color: "var(--text-muted)" }}
              >
                <p>{t("stats:timeBasedAnalytics.noData")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

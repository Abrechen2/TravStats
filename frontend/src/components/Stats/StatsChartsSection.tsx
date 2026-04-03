import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "../../hooks/useTranslation";

interface MonthlyDataPoint {
  month: string;
  flights: number;
}

interface YearlyDataPoint {
  year: string;
  flights: number;
}

interface SeasonalDataPoint {
  month: string;
  flights: number;
}

interface WeekdayDataPoint {
  day: string;
  flights: number;
}

interface StatsChartsSectionProps {
  yearlyData: YearlyDataPoint[];
  monthlyData: MonthlyDataPoint[];
  seasonalData: SeasonalDataPoint[];
  weekdayData: WeekdayDataPoint[];
  hasFlights: boolean;
}

export default function StatsChartsSection({
  yearlyData,
  monthlyData,
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

      {/* Yearly Trend */}
      {yearlyData.length > 0 && (
        <div
          className="rounded-lg shadow-lg p-6 mb-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:timeBasedAnalytics.yearlyTrend")}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={yearlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="year"
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
              <Line
                type="monotone"
                dataKey="flights"
                stroke="var(--accent)"
                strokeWidth={2}
                name={t("stats:timeBasedAnalytics.flightsLabel")}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Bar Chart */}
      {monthlyData.length > 0 && (
        <div
          className="rounded-lg shadow-lg p-6 mb-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            {t("stats:timeBasedAnalytics.monthlyFlights")}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="month"
                stroke="var(--text-muted)"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                angle={-45}
                textAnchor="end"
                height={80}
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
        </div>
      )}

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

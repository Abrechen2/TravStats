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
import EvidenceTrigger from "./EvidenceTrigger";
import CountingHelp from "./counting/CountingHelp";
import { rankingKey, type RankingDimension } from "../../shared/evidence";

const ALL_TIME = { period: "allTime" as const };

/**
 * The bars again, as buttons: a bar is not focusable, so this row is how a
 * keyboard or a finger opens the flights behind one month or weekday
 * (`departureMonth` / `departureWeekday`, forgejo#256). `toKey` turns the
 * bar's position into the dimension's value — month 1–12, weekday 0–6 from
 * Sunday, the order the page builds the data in.
 */
function BarEntries({
  bars,
  dimension,
  toKey,
}: {
  bars: ReadonlyArray<{ label: string; flights: number }>;
  dimension: RankingDimension;
  toKey: (index: number) => number;
}): JSX.Element {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {bars.map((bar, index) =>
        bar.flights > 0 ? (
          <li key={bar.label}>
            <EvidenceTrigger
              kind="ranking"
              evidenceKey={rankingKey(dimension, String(toKey(index)))}
              scope={ALL_TIME}
              renderedValue={bar.flights}
              label={`${bar.label}: ${bar.flights}`}
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              style={{ width: "auto", color: "var(--text-muted)" }}
            >
              {bar.label} {bar.flights}
            </EvidenceTrigger>
          </li>
        ) : null
      )}
    </ul>
  );
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
            ) : null}
            {seasonalData.some((d) => d.flights > 0) ? (
              <BarEntries
                bars={seasonalData.map((d) => ({ label: d.month, flights: d.flights }))}
                dimension="departureMonth"
                toKey={(index) => index + 1}
              />
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
            ) : null}
            {weekdayData.some((d) => d.flights > 0) ? (
              <BarEntries
                bars={weekdayData.map((d) => ({ label: d.day, flights: d.flights }))}
                dimension="departureWeekday"
                toKey={(index) => index}
              />
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
      <CountingHelp
        testId="charts-counting-help"
        entries={[
          {
            term: t("stats:timeBasedAnalytics.seasonalPatterns"),
            helpKey: "flightStatsHelp:charts.seasonal",
          },
          {
            term: t("stats:timeBasedAnalytics.weekdayAnalysis"),
            helpKey: "flightStatsHelp:charts.weekday",
          },
        ]}
      />
    </div>
  );
}

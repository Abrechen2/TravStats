import type { JSX } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TimeseriesPoint } from "../../../lib/api/types";

interface CanonicalTimeSeriesProps {
  series: TimeseriesPoint[];
  title: string;
}

// The single canonical flights-per-period chart. Zero-baseline bars (HIG/M3:
// bar heights stay proportional). Replaces the redundant yearly+monthly pair.
export default function CanonicalTimeSeries({
  series,
  title,
}: CanonicalTimeSeriesProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const hasData = series.some((p) => p.count > 0);

  return (
    <div
      className="rounded-lg shadow-lg p-6 mb-6"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="period"
              stroke="var(--text-muted)"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "auto"]}
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
            <Bar
              dataKey="count"
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
          <p>{t("stats:timeRange.noData")}</p>
        </div>
      )}
    </div>
  );
}

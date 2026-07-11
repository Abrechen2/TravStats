import type { JSX } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "../../../../hooks/useTranslation";
import { DOMAINS } from "../../../../shared/domains";

interface LodgingNightsChartProps {
  /** `LodgingStats.nightsByMonth` — "YYYY-MM" keys, already summed server-side. */
  nightsByMonth: Record<string, number>;
}

interface NightsPoint {
  period: string;
  nights: number;
}

/**
 * "Nights over time" mode — a bar-per-month rollup. Data is used exactly as
 * `getLodgingStats()` returns it (server already buckets nights by month);
 * this component only sorts and shapes it for recharts, it does not
 * recompute anything from raw stays.
 */
export function LodgingNightsChart({ nightsByMonth }: LodgingNightsChartProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const series: NightsPoint[] = Object.entries(nightsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, nights]) => ({ period, nights }));

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        right: 12,
        maxWidth: 640,
        zIndex: 25,
        padding: 16,
        borderRadius: 12,
        // Solid, not translucent — this card sits over the map's own
        // bottom-left FlatMapControlPanel; a translucent background let
        // its text bleed through as faded ghost text underneath.
        background: "var(--bg-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-primary)" }}>
        {t("dashboard:lodgingTab.nightsChartTitle")}
      </h3>
      {series.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:lodgingTab.nightsChartEmpty")}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="period"
              stroke="var(--text-muted)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "auto"]}
              stroke="var(--text-muted)"
              tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--text-primary)",
              }}
            />
            <Bar
              dataKey="nights"
              fill={DOMAINS.lodging.color}
              radius={[4, 4, 0, 0]}
              name={t("dashboard:lodgingTab.stats.nights")}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

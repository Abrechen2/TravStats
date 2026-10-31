import type { JSX } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { token } from "../../../components/ui/tokens";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TravTrackMonths } from "../../../lib/api/travtrackMonths";
import { appLocale, convertDistance, getDistanceLabel } from "../../../lib/units";
import { useSettingsStore } from "../../../store/settingsStore";
import { TRACK_COLOR } from "../map/trackMapLayers";

export interface KmBar {
  month: string;
  label: string;
  /** In the reader's unit; null for a month without data or still being computed. */
  value: number | null;
}

/**
 * The twelve months of the year as bars: a month with values carries its
 * ground distance, a month without data or still being computed has no bar
 * (null, never a bar of 0 — an absent month is not a measured zero).
 */
export function kmBars(
  data: TravTrackMonths,
  year: number,
  convert: (km: number) => number,
  label: (month: string) => string
): KmBar[] {
  const byMonth = new Map(data.months.map((m) => [m.month, m.kmGround]));
  const pending = new Set(data.pending);
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const km = byMonth.get(month);
    return {
      month,
      label: label(month),
      value: km === undefined || pending.has(month) ? null : convert(km),
    };
  });
}

/** Kilometres per month above the monthly table (board „Track-Karte", Statistik). */
export default function TrackKmChart({
  data,
  year,
}: {
  data: TravTrackMonths;
  year: number;
}): JSX.Element {
  const { t, i18n } = useTranslation(["track", "stats"]);
  const units = useSettingsStore((s) => s.units);
  const short = new Intl.DateTimeFormat(appLocale(i18n.language), {
    month: "short",
    timeZone: "UTC",
  });
  const bars = kmBars(
    data,
    year,
    (km) => Math.round(convertDistance(km, units.distanceUnit)),
    (month) => short.format(new Date(`${month}-01T00:00:00Z`))
  );
  const unit = getDistanceLabel(units.distanceUnit, t);
  const number = new Intl.NumberFormat(appLocale(i18n.language));
  return (
    <figure className="flex flex-col gap-1" style={{ margin: 0 }} data-testid="track-km-chart">
      <h2 className="t-card-title">{t("track:months.chartTitle", { unit })}</h2>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={token("border")} />
            <XAxis
              dataKey="label"
              stroke={token("muted")}
              tick={{ fill: token("muted"), fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke={token("muted")}
              tick={{ fill: token("muted"), fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ fill: token("surface2") }}
              formatter={(value) => [
                `${number.format(Number(value))} ${unit}`,
                t("track:months.km"),
              ]}
              contentStyle={{
                background: token("surface2"),
                border: `1px solid ${token("border")}`,
                borderRadius: 8,
                color: token("text"),
              }}
            />
            <Bar dataKey="value" fill={TRACK_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="t-caption">{t("track:months.chartNote")}</figcaption>
    </figure>
  );
}

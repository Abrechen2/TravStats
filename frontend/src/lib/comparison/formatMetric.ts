import { formatDistance, formatNumber, type DistanceUnit } from "../units";
import { formatDuration } from "../formatters";
import type { MetricUnit } from "../../shared/comparisonMetrics";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What is printed for a figure that is absent or not derivable — never a zero. */
export const ABSENT_MARKER = "—";

interface FormatContext {
  distanceUnit: DistanceUnit;
  t: Translate;
  language: string;
}

/** One leaderboard value as the statistics pages print it: the reader's unit and language. */
export function formatMetricValue(value: number, unit: MetricUnit, ctx: FormatContext): string {
  const whole = formatNumber(value, { maximumFractionDigits: 0 }, ctx.language);
  switch (unit) {
    case "km":
      return formatDistance(value, ctx.distanceUnit, ctx.t, ctx.language);
    case "minutes":
      return formatDuration(value);
    case "days":
      return ctx.t("comparison:unit.days", { count: value, value: whole });
    case "nights":
      return ctx.t("comparison:unit.nights", { count: value, value: whole });
    case "count":
      return whole;
  }
}

/** Like `formatMetricValue`, but a missing value is the absence marker, not "0". */
export function formatMetricOrAbsent(
  value: number | null | undefined,
  unit: MetricUnit,
  ctx: FormatContext
): string {
  return typeof value === "number" ? formatMetricValue(value, unit, ctx) : ABSENT_MARKER;
}

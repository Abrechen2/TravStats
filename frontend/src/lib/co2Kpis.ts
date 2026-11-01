import type { DetailKpi } from "../components/ui/DetailKpis";
import type { Co2Estimate } from "../types/co2";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The CO2 figures of a ride, a cruise or a rental for a detail page's KPI strip
 * (forgejo#395): the estimate, and — only where a flight was a real alternative
 * and the ride was the cleaner choice — the saving against flying. Both say
 * "estimate"; a cruise says "lower bound". Nothing for a record that abstained:
 * an unknown distance shows no figure rather than a zero.
 */
export function co2Kpis(
  co2: Co2Estimate | null | undefined,
  t: Translate,
  locale: string
): DetailKpi[] {
  if (!co2) return [];
  const kg = (n: number): string => `${Math.round(n).toLocaleString(locale)} kg`;
  const basis = co2.perVehicle
    ? "co2.labelVehicle"
    : co2.lowerBound
      ? "co2.labelLowerBound"
      : "co2.label";
  return [
    { key: "co2", value: `≈ ${kg(co2.kg)}`, label: t(`common:${basis}`) },
    ...(co2.savedKg !== null && co2.savedKg > 0
      ? [
          {
            key: "co2Saved",
            value: `≈ ${kg(co2.savedKg)}`,
            label: t("common:co2.savedVsFlight"),
          },
        ]
      : []),
  ];
}

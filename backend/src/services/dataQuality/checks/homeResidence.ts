import { HOME_FLAG_ENTITY_ID } from "../../../schemas/dataQualityFlag";
import type { HomePeriod } from "../../../utils/homeAirport";
import type { DataQualityFinding } from "../types";

/**
 * "Wohnort bestätigen und weitere Heimatflughäfen wählen?" — asked ONCE per
 * account while any home period still carries the residence it was migrated
 * with (the old one-airport shape; owner decision 2026-09-27).
 *
 * One question, not one per period: the answer is one visit to the settings
 * page, where every period is shown. Confirming the last period makes the
 * next run resolve it; dismissing it keeps the statistics as they were, which
 * is exactly what an unconfirmed period already does.
 */
export function findUnconfirmedResidence(periods: readonly HomePeriod[]): DataQualityFinding[] {
  const open = periods.filter((p) => !p.residenceConfirmed);
  if (open.length === 0) return [];
  const airports: string[] = [];
  for (const period of open) {
    for (const airport of period.airports) {
      if (!airports.includes(airport.code)) airports.push(airport.code);
    }
  }
  return [
    {
      entityType: "home",
      entityId: HOME_FLAG_ENTITY_ID,
      kind: "home_residence_unconfirmed",
      details: { airports, periods: open.length },
    },
  ];
}

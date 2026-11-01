/**
 * Evidence measures — the carbon-per-mode tiles of the overview (forgejo#395).
 * Each lists the rides, cruises or rentals behind a mode's figure with their
 * own kilograms (`services/co2/co2Rows.ts`, one estimate per record), lifetime
 * only: the section takes no period. The flight tile keeps `co2FootprintKg`.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresCo2.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const CO2 = (): MeasureSpec => ({
  aggregation: "sum",
  unit: "kg",
  scopes: ["allTime"],
  surface: "CarbonByModeSection",
  calculator: "services/evidence/metricEvidenceCo2.ts over services/co2/co2Rows.ts",
  servedIn: 1,
});

export const CO2_MEASURES: Record<string, MeasureSpec> = {
  co2RailKg: CO2(),
  co2BusKg: CO2(),
  co2FerryKg: CO2(),
  co2CruiseKg: CO2(),
  co2RentalKg: CO2(),
  co2SavedVsFlightKg: CO2(),
};

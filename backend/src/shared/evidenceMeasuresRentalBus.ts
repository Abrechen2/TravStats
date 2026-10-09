/**
 * Evidence measures — the rental and bus statistics tabs and their badges
 * (forgejo#262, #263). Rentals count by `shared/rentalCounting.ts` (completed,
 * filed under the pickup's year on the pickup station's calendar), bus rides
 * by `shared/busCounting.ts` (completed, the year they left on the departure
 * terminal's calendar) — the same rules the tabs and the badges read.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresRentalBus.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const measure = (
  aggregation: "sum" | "distinct",
  unit: string,
  surface: string,
  calculator: string
): MeasureSpec => ({
  aggregation,
  unit,
  scopes: ["allTime", "year"],
  surface,
  calculator,
  servedIn: 1,
});

const RENTAL = (aggregation: "sum" | "distinct", unit: string): MeasureSpec =>
  measure(
    aggregation,
    unit,
    "RentalStatsSection",
    "services/evidence/metricEvidenceRental.ts over utils/rentalAchievements.ts"
  );

const BUS = (aggregation: "sum" | "distinct", unit: string): MeasureSpec =>
  measure(
    aggregation,
    unit,
    "BusStatsSection",
    "services/evidence/metricEvidenceBus.ts over services/bus/busStats.ts"
  );

export const RENTAL_BUS_MEASURES: Record<string, MeasureSpec> = {
  rentalCount: RENTAL("sum", "rentals"),
  rentalDaysTotal: RENTAL("sum", "days"),
  rentalOneWayCount: RENTAL("sum", "rentals"),
  rentalOdometerDocumentedCount: RENTAL("sum", "rentals"),
  busRideCount: BUS("sum", "rides"),
  busDistanceKmTotal: BUS("sum", "km"),
  busCountriesCount: BUS("distinct", "countries"),
  busNightRideCount: BUS("sum", "rides"),
  busTerminalsCount: BUS("distinct", "terminals"),
};

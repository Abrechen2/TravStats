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
  // forgejo#262 — the tab's further tiles. A ratio (km per day, cost per day,
  // cost per km) opens the rentals it stands on; a record opens its one
  // witness; the rest are counts.
  rentalKmTotal: RENTAL("sum", "km"),
  rentalCostedCount: RENTAL("sum", "rentals"),
  rentalBrokeredCount: RENTAL("sum", "rentals"),
  rentalKmPerDaySampleCount: RENTAL("sum", "rentals"),
  rentalCostPerKmSampleCount: RENTAL("sum", "rentals"),
  rentalVehicleComparedCount: RENTAL("sum", "rentals"),
  rentalDrivenModelsCount: RENTAL("distinct", "models"),
  rentalLongest: RENTAL("sum", "days"),
  rentalFarthest: RENTAL("sum", "km"),
  rentalNewProvidersCount: RENTAL("distinct", "providers"),
  busRideCount: BUS("sum", "rides"),
  busDistanceKmTotal: BUS("sum", "km"),
  busCountriesCount: BUS("distinct", "countries"),
  busNightRideCount: BUS("sum", "rides"),
  busTerminalsCount: BUS("distinct", "terminals"),
  // forgejo#263 — hours over the rides with both clocks, the changes the
  // average change time is taken over, and two records as their witnesses.
  busHoursOnBoard: BUS("sum", "hours"),
  busTransferCount: BUS("sum", "transfers"),
  busLongestRide: BUS("sum", "km"),
  /** A lifetime figure on the tab whatever year is picked. */
  busLongestReturn: { ...BUS("sum", "days"), scopes: ["allTime"] },
};

import { expect, it } from "vitest";
import { adaptFerry } from "../ferryStatsAdapter";
import type { FerryJourney } from "../../../../types/ferry";
it("counts sea estimates separately from ticket and straight distances", () => {
  const ride = {
    id: "synthetic",
    status: "completed",
    departureTime: "2025-10-09T08:00:00Z",
    arrivalTime: "2025-10-09T16:00:00Z",
    depTimezone: "Europe/Rome",
    arrTimezone: "Europe/Zagreb",
    depCountry: "IT",
    arrCountry: "HR",
    distanceKm: 201.4,
    distanceSource: "sea_route",
    operator: "Test ferry",
  } as FerryJourney;
  const stats = adaptFerry({ journeys: [ride] });
  if (!stats.hasData) throw new Error("expected data");
  expect(stats.totalDistanceKm).toBe(201.4);
  expect(stats.summaryByYear?.[2025].headlineKpis).toContainEqual({
    labelKey: "overviewCard.kpi.ferryKmSeaRoute",
    value: 201,
    unit: "km",
  });
  expect(
    stats.summaryByYear?.[2025].headlineKpis.some(
      (k) => k.labelKey === "overviewCard.kpi.ferryKmMeasured"
    )
  ).toBe(false);
  expect(
    stats.summaryByYear?.[2025].headlineKpis.some(
      (k) => k.labelKey === "overviewCard.kpi.ferryKmStraight"
    )
  ).toBe(false);
});

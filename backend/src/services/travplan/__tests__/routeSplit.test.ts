import { randomUUID } from "crypto";
import { emptyState, vehicleSchema } from "../schema";
import { suggestDriveSplits } from "../routeSplit";
import type { PlanStage, PlanState, PlanStation, PlanVehicle } from "../types";

const station = (title: string, lat: number, lon: number): PlanStation => ({
  id: randomUUID(),
  title,
  place: { name: title, lat, lon, country: null, zone: null, ref: null },
  nights: 0,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
});
const stage = (a: PlanStation, b: PlanStation, extra: Partial<PlanStage> = {}): PlanStage => ({
  id: randomUUID(),
  fromStationId: a.id,
  toStationId: b.id,
  mode: "drive",
  departDay: null,
  departTime: null,
  durationMinutes: null,
  distanceKm: null,
  metricsSource: null,
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
  ...extra,
});
const vehicle = (extra: Partial<PlanVehicle>): PlanVehicle => ({
  kind: "motorhome",
  lengthM: null,
  consumptionPer100: null,
  fuelPrice: null,
  fuelCurrency: null,
  ...extra,
});
const plan = (stages: PlanStage[], stations: PlanStation[], v: PlanVehicle | null): PlanState => ({
  ...emptyState(),
  shape: "route",
  stations,
  stages,
  vehicle: v,
});

describe("suggestDriveSplits", () => {
  const a = station("A", 48, 12),
    b = station("B", 40, 12);

  it("cuts a drive over the minutes limit into days with stops on the line between", () => {
    const g = stage(a, b, { durationMinutes: 600 });
    const [split] = suggestDriveSplits(plan([g], [a, b], vehicle({ maxDriveMinutesPerDay: 300 })));
    expect(split).toMatchObject({ stageId: g.id, days: 2, approximate: true });
    expect(split.legs).toEqual([
      { minutes: 300, km: null },
      { minutes: 300, km: null },
    ]);
    expect(split.stops).toEqual([{ lat: 44, lon: 12, afterMinutes: 300, afterKm: null }]);
  });

  it("uses the km limit, and the limit needing more days when both are set", () => {
    const g = stage(a, b, { durationMinutes: 400, distanceKm: 900 });
    const [split] = suggestDriveSplits(
      plan([g], [a, b], vehicle({ maxDriveMinutesPerDay: 300, maxDriveKmPerDay: 300 }))
    );
    expect(split.days).toBe(3);
    expect(split.stops).toHaveLength(2);
    expect(split.stops[1].afterKm).toBe(600);
  });

  it("suggests nothing without a limit, without the matching figure, or within the limit", () => {
    const g = stage(a, b, { durationMinutes: 600 });
    expect(suggestDriveSplits(plan([g], [a, b], null))).toEqual([]);
    expect(suggestDriveSplits(plan([g], [a, b], vehicle({})))).toEqual([]);
    // A km limit cannot cut a stage that only knows its duration.
    expect(suggestDriveSplits(plan([g], [a, b], vehicle({ maxDriveKmPerDay: 100 })))).toEqual([]);
    expect(
      suggestDriveSplits(plan([g], [a, b], vehicle({ maxDriveMinutesPerDay: 600 })))
    ).toEqual([]);
    const ferry = stage(a, b, { mode: "ferry", durationMinutes: 900 });
    expect(
      suggestDriveSplits(plan([ferry], [a, b], vehicle({ maxDriveMinutesPerDay: 300 })))
    ).toEqual([]);
  });

  it("accepts a stored vehicle without limits and refuses an absurd one", () => {
    const base = { kind: "car", lengthM: null, consumptionPer100: null, fuelPrice: null, fuelCurrency: null };
    expect(vehicleSchema.safeParse(base).success).toBe(true);
    expect(vehicleSchema.safeParse({ ...base, maxDriveKmPerDay: 400, maxDriveMinutesPerDay: null }).success).toBe(true);
    expect(vehicleSchema.safeParse({ ...base, maxDriveMinutesPerDay: -5 }).success).toBe(false);
  });
});

import { describe, it, expect } from "@jest/globals";
import { calculateCruiseStats, type CruiseData, type CruisePortData } from "../cruiseStats";
import { resolveCruiseKind } from "../../shared/cruiseKind";

const port = (id: number, region: string, lat: number, lon: number): CruisePortData => ({
  id,
  name: `P${id}`,
  city: null,
  country: "Egypt",
  region,
  unlocode: null,
  lat,
  lon,
  timezone: null,
  isUserAdded: false,
});

/** A Nile week and an Atlantic week, each with two days between ports. */
function cruise(id: string, kind: "ocean" | "river" | undefined): CruiseData {
  return {
    id,
    kind,
    shipId: null,
    cruiseLine: null,
    cabinType: null,
    deck: null,
    startDate: new Date("2025-12-28"),
    endDate: new Date("2026-01-03"),
    stops: [
      { portId: 1, port: port(1, "river_nile", 25.7, 32.6), dayNumber: 1, isAtSea: false },
      { portId: null, port: null, dayNumber: 2, isAtSea: true },
      { portId: null, port: null, dayNumber: 3, isAtSea: true },
      { portId: 2, port: port(2, "river_nile", 24.1, 32.9), dayNumber: 4, isAtSea: false },
    ],
  };
}

/**
 * #359: a river cruise is not a short ocean cruise. Its days between ports are
 * on the river, so they must not inflate the sea days, and New Year on the
 * Nile is not New Year at sea — while the cruise itself still counts.
 */
describe("calculateCruiseStats — river vs ocean (#359)", () => {
  it("keeps a river cruise's portless days out of the sea days", () => {
    const s = calculateCruiseStats([cruise("nile", "river"), cruise("atlantic", "ocean")]);
    expect(s.cruisesCount).toBe(2);
    expect(s.riverCruisesCount).toBe(1);
    expect(s.seaDays).toBe(2);
    expect(s.seaDaysStreak).toBe(2);
  });

  it("splits out the distance sailed on rivers", () => {
    const s = calculateCruiseStats([cruise("nile", "river"), cruise("atlantic", "ocean")]);
    expect(s.riverDistanceKm).toBeGreaterThan(0);
    expect(s.riverDistanceKm).toBeCloseTo(s.totalDistanceKm / 2, 5);
  });

  it("does not call New Year on a river 'at sea'", () => {
    expect(calculateCruiseStats([cruise("nile", "river")]).hasNewYearsAtSea).toBe(false);
    expect(calculateCruiseStats([cruise("atlantic", "ocean")]).hasNewYearsAtSea).toBe(true);
  });

  it("reads a row without a kind as ocean", () => {
    const s = calculateCruiseStats([cruise("legacy", undefined)]);
    expect(s.riverCruisesCount).toBe(0);
    expect(s.seaDays).toBe(2);
  });
});

describe("resolveCruiseKind (#359)", () => {
  it("prefers an explicit choice, then the ship, then ocean", () => {
    expect(resolveCruiseKind("ocean", "river")).toBe("ocean");
    expect(resolveCruiseKind(undefined, "river")).toBe("river");
    expect(resolveCruiseKind(undefined, null)).toBe("ocean");
    expect(resolveCruiseKind(undefined, "hovercraft")).toBe("ocean");
  });
});

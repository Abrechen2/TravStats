import { haversineCalculator } from "../haversineCalculator";
import { computeLegDistance } from "../index";
import type { PortPoint } from "../types";

const KIEL: PortPoint = {
  id: 1,
  lat: 54.32,
  lon: 10.14,
  unlocode: "DEKEL",
  region: "baltic",
};
const COPENHAGEN: PortPoint = {
  id: 2,
  lat: 55.68,
  lon: 12.57,
  unlocode: "DKCPH",
  region: "baltic",
};
const NEW_YORK: PortPoint = {
  id: 3,
  lat: 40.71,
  lon: -74.0,
  unlocode: "USNYC",
  region: "atlantic",
};

describe("haversineCalculator", () => {
  it("accepts every port pair", () => {
    expect(haversineCalculator.accepts(KIEL, COPENHAGEN)).toBe(true);
  });

  it("returns a low-confidence haversine result", async () => {
    const result = await haversineCalculator.compute(KIEL, COPENHAGEN);
    expect(result.method).toBe("haversine");
    expect(result.confidence).toBe("low");
    expect(result.dataVersion).toBeNull();
    expect(result.distanceKm).toBeGreaterThan(180);
    expect(result.distanceKm).toBeLessThan(220);
  });

  it("matches a known transatlantic ballpark within 5%", async () => {
    // Kiel → New York great-circle ≈ 6360 km
    const result = await haversineCalculator.compute(KIEL, NEW_YORK);
    expect(result.distanceKm).toBeGreaterThan(6050);
    expect(result.distanceKm).toBeLessThan(6700);
  });
});

describe("computeLegDistance orchestrator", () => {
  it("falls through to haversine when no other calculator accepts", async () => {
    const result = await computeLegDistance(KIEL, COPENHAGEN);
    expect(result.method).toBe("haversine");
    expect(result.routerVersion).toBe("1.0.0");
  });
});

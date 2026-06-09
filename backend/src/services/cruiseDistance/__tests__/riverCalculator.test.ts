import {
  riverCalculator,
  __resetRiverCache,
} from "../riverCalculator";
import type { PortPoint } from "../types";

const BASEL: PortPoint = {
  id: 1, lat: 47.5594, lon: 7.5886, unlocode: null, region: "river_rhine",
};
const COLOGNE: PortPoint = {
  id: 2, lat: 50.9417, lon: 6.9583, unlocode: null, region: "river_rhine",
};
const AMSTERDAM_RHINE: PortPoint = {
  id: 3, lat: 52.37, lon: 4.90, unlocode: null, region: "river_rhine",
};
const PASSAU: PortPoint = {
  id: 4, lat: 48.5747, lon: 13.4561, unlocode: null, region: "river_danube",
};
const BUDAPEST: PortPoint = {
  id: 5, lat: 47.4979, lon: 19.0402, unlocode: null, region: "river_danube",
};
const HAMBURG: PortPoint = {
  id: 6, lat: 53.55, lon: 9.99, unlocode: "DEHAM", region: "north_sea",
};
const MAINZ_RHINE: PortPoint = {
  id: 7, lat: 50.0, lon: 8.2711, unlocode: null, region: "river_rhine",
};
const LYON_RHONE: PortPoint = {
  id: 8, lat: 45.76, lon: 4.84, unlocode: null, region: "river_rhone",
};
const ARLES_RHONE: PortPoint = {
  id: 9, lat: 43.6767, lon: 4.6275, unlocode: null, region: "river_rhone",
};

describe("riverCalculator", () => {
  beforeEach(() => __resetRiverCache());

  it("rejects ports on different rivers", () => {
    expect(riverCalculator.accepts(BASEL, PASSAU)).toBe(false);
  });

  it("rejects port pairs where one isn't a river port", () => {
    expect(riverCalculator.accepts(BASEL, HAMBURG)).toBe(false);
  });

  it("accepts both ports on the same river", () => {
    expect(riverCalculator.accepts(BASEL, COLOGNE)).toBe(true);
    expect(riverCalculator.accepts(PASSAU, BUDAPEST)).toBe(true);
  });

  it("Basel → Cologne via Rhine ≈ 518 km (688−170, authoritative river-km)", async () => {
    const result = await riverCalculator.compute(BASEL, COLOGNE);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("river-osm");
    expect(result!.distanceKm).toBeCloseTo(518, 0);
    expect(result!.confidence).toBe("high");
  });

  it("Mainz → Cologne via Rhine ≈ 190 km (688−498)", async () => {
    const result = await riverCalculator.compute(MAINZ_RHINE, COLOGNE);
    expect(result!.distanceKm).toBeCloseTo(190, 0);
  });

  it("Passau → Budapest via Danube ≈ 579 km (2226−1647)", async () => {
    const result = await riverCalculator.compute(PASSAU, BUDAPEST);
    expect(result!.distanceKm).toBeCloseTo(579, 0);
  });

  it("returns symmetric distance regardless of from/to order", async () => {
    const ab = await riverCalculator.compute(BASEL, COLOGNE);
    const ba = await riverCalculator.compute(COLOGNE, BASEL);
    expect(ab!.distanceKm).toBeCloseTo(ba!.distanceKm, 5);
  });

  it("uses meander-factor math for rivers without km anchors (Rhône)", async () => {
    const result = await riverCalculator.compute(LYON_RHONE, ARLES_RHONE);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("river-osm");
    // Lyon → Arles chord ≈ 232 km. With meander factor 1.10 → ~255 km.
    // Real Rhône cruise distance is ~280 km, so we're slightly under.
    expect(result!.distanceKm).toBeGreaterThan(220);
    expect(result!.distanceKm).toBeLessThan(290);
  });

  it("returns 0 for from=to", async () => {
    const result = await riverCalculator.compute(BASEL, BASEL);
    expect(result!.distanceKm).toBeCloseTo(0, 1);
  });
});

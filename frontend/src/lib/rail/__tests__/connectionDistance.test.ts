import { describe, expect, it } from "vitest";
import { connectionDistance } from "../connectionDistance";
describe("connection distance", () => {
  it("sums known legs while naming mixed sources", () => {
    expect(
      connectionDistance([
        { distanceKm: 100, distanceSource: "route" },
        { distanceKm: 40, distanceSource: "great_circle" },
      ])
    ).toEqual({ km: 140, missing: 0, mixed: true, source: null });
  });
  it("does not count an unknown distance as a zero-length journey", () => {
    expect(
      connectionDistance([
        { distanceKm: 100, distanceSource: "route" },
        { distanceKm: null, distanceSource: null },
      ])
    ).toMatchObject({ km: 100, missing: 1 });
    expect(connectionDistance([{ distanceKm: null, distanceSource: null }])).toMatchObject({
      km: null,
      missing: 1,
    });
  });
});

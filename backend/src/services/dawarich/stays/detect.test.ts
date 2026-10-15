import { detectStays } from "./detect";
import type { DawarichPoint } from "../dawarichClient";
const point = (minute: number, over: Partial<DawarichPoint> = {}): DawarichPoint => ({
  id: minute,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.parse("2026-10-10T14:50:00Z") + minute * 60_000,
  accuracy: 15,
  altitude: null,
  velocity: null,
  trackId: null,
  ...over,
});
describe("Dawarich stationary evidence", () => {
  it("finds a stay crossing Seoul midnight and retains uncertain provenance", () => {
    const [s] = detectStays([point(0), point(10), point(20)]);
    expect(s.pointCount).toBe(3);
    expect(s.startAt.toISOString()).toBe("2026-10-10T14:50:00.000Z");
    expect(s.uncertainties).toContain("sourceUnknown");
  });
  it("does not turn a drive-through or two sparse points into a stay", () => {
    expect(
      detectStays([point(0), point(10, { latitude: 37.6 }), point(20, { latitude: 37.7 })])
    ).toEqual([]);
    expect(detectStays([point(0), point(25)])).toEqual([]);
  });
  it("splits repeated visits around a long signal gap", () => {
    expect(detectStays([0, 10, 20, 100, 110, 120].map((n) => point(n)))).toHaveLength(2);
  });
  it("ignores an isolated jump without claiming the missing interval is measured", () => {
    const [s] = detectStays([
      point(0),
      point(10),
      point(15, { latitude: 60 }),
      point(20),
      point(30),
    ]);
    expect(s.pointCount).toBe(4);
    expect(s.uncertainties).toContain("outliersIgnored");
  });
  it("does not join two stays through poor accuracy or a long outlier gap", () => {
    expect(detectStays([point(0), point(10), point(20, { accuracy: 500 })])).toEqual([]);
    expect(detectStays([point(0), point(10, { latitude: 60 }), point(90)])).toEqual([]);
  });
  it("reports gaps, missing accuracy and truncated results", () => {
    const [s] = detectStays([point(0, { accuracy: null }), point(15), point(30)], true);
    expect(s.uncertainties).toEqual(
      expect.arrayContaining(["signalGaps", "accuracyUnknown", "truncated"])
    );
  });
  it("sorts and deduplicates timestamps before applying the minimum evidence threshold", () => {
    expect(detectStays([point(20), point(0), point(0)])).toEqual([]);
  });
});

it("keeps a stationary cluster at the dateline instead of moving it to Greenwich", () => {
  const [stay] = detectStays([
    point(0, { latitude: 0, longitude: 179.9997 }),
    point(10, { latitude: 0, longitude: -179.9998 }),
    point(20, { latitude: 0, longitude: 179.9999 }),
  ]);
  expect(Math.abs(stay.lon)).toBeGreaterThan(179.999);
});
it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
  "does not use invalid velocity %s as stationary evidence",
  (velocity) => {
    expect(detectStays([point(0), point(10, { velocity }), point(20)])).toEqual([]);
  }
);

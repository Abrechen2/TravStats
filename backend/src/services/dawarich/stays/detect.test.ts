import { detectStays, MERGE_GAP_MS } from "./detect";
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

it("summarises a month-long stay with hundreds of thousands of points", () => {
  // A phone logging every few seconds at home: spreading every gap into
  // Math.max threw a RangeError and failed the whole scan.
  const points = Array.from({ length: 300_000 }, (_, i) => point(i / 10, { id: i }));
  const [stay] = detectStays(points);
  expect(stay.pointCount).toBe(300_000);
  expect(stay.maxGapMinutes).toBeCloseTo(0.1);
});

describe("one place, one stay: fragments are merged (prod 24./25.11.2026)", () => {
  // One fix a minute from `from` to `to` (minutes after 14:50 UTC), at an offset in metres north.
  const run = (from: number, to: number, over: Partial<DawarichPoint> = {}) =>
    Array.from({ length: to - from + 1 }, (_, i) => point(from + i, over));
  const north = (m: number) => ({ latitude: 37.57 + m / 111_000 });

  it("joins a stay split by one fast fix a minute apart, keeping every point", () => {
    // 24.11.: 10:16-11:55 and 11:56-14:15 at the same spot.
    const points = [...run(0, 99), point(99.5, { velocity: 8 }), ...run(100, 239)];
    const stays = detectStays(points);
    expect(stays).toHaveLength(1);
    expect(stays[0].pointCount).toBe(240);
    expect(stays[0].uncertainties).toContain("outliersIgnored");
  });

  it("joins four stays at one building with gaps of 0-40 minutes", () => {
    // 25.11.: 10:40-12:58, 12:58-13:32, 14:11-15:03, 15:42-16:04, the anchor drifting a little.
    const points = [
      ...run(0, 138),
      point(138.1, { velocity: 4 }),
      ...run(139, 172, north(20)),
      ...run(211, 263, north(-15)),
      ...run(302, 324, north(10)),
    ];
    const stays = detectStays(points);
    expect(stays).toHaveLength(1);
    expect(stays[0].startAt.toISOString()).toBe("2026-10-10T14:50:00.000Z");
    expect(stays[0].endAt.getTime() - stays[0].startAt.getTime()).toBe(324 * 60_000);
    expect(stays[0].uncertainties).toContain("signalGaps");
  });

  it("keeps two stays when the gap's fixes show the device left", () => {
    const away = run(41, 60, north(600));
    expect(detectStays([...run(0, 30), ...away, ...run(70, 100)])).toHaveLength(2);
  });

  it("keeps two stays at neighbouring places, and two stays too far apart in time", () => {
    expect(detectStays([...run(0, 30), ...run(32, 62, north(250))])).toHaveLength(2);
    const later = 30 + MERGE_GAP_MS / 60_000 + 5;
    expect(detectStays([...run(0, 30), ...run(later, later + 30)])).toHaveLength(2);
  });
});

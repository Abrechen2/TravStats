import type { LocationObservation } from "../../locationProvider/types";
import { anomalyMask } from "../anomaly";

/**
 * Anomalies of a TravTrack read (TravTrack plan E2): Dawarich's thresholds,
 * per device. Masked, never deleted — the mask is a verdict on the read, the
 * stored points stay.
 */

const BASE = Date.parse("2026-10-12T00:00:00Z");
const SEOUL = { lat: 37.5665, lon: 126.978 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };

let seq = 0;
const obs = (
  secondsIn: number,
  at: { lat: number; lon: number } = SEOUL,
  extra: Partial<LocationObservation> = {}
): LocationObservation => ({
  ref: String((seq += 1)),
  atMs: BASE + secondsIn * 1000,
  lat: at.lat,
  lon: at.lon,
  accuracyM: 8,
  altitudeM: null,
  speedMps: null,
  courseDeg: null,
  deviceId: "phone-1",
  ...extra,
});

/** A walk through Seoul: one fix a minute, a few metres apart. */
const walk = (fromMinute: number, count: number, device = "phone-1") =>
  Array.from({ length: count }, (_, i) =>
    obs(
      (fromMinute + i) * 60,
      { lat: SEOUL.lat + (fromMinute + i) * 0.0001, lon: SEOUL.lon },
      { deviceId: device }
    )
  );

describe("anomalyMask", () => {
  it("a frozen-fix teleport is masked, the points around it stay", () => {
    const before = walk(0, 5);
    const frozen = obs(5 * 60 + 30, BUSAN);
    const after = walk(6, 5);
    const mask = anomalyMask([...before, frozen, ...after]);
    expect(mask).toEqual([...before.map(() => false), true, ...after.map(() => false)]);
  });

  it("a run of up to five points between two jumps is masked; six are a real move", () => {
    const run = (n: number) => [
      ...walk(0, 3),
      ...Array.from({ length: n }, (_, i) => obs(3 * 60 + i, BUSAN)),
      ...walk(10, 3),
    ];
    expect(anomalyMask(run(5)).filter(Boolean)).toHaveLength(5);
    expect(anomalyMask(run(6)).filter(Boolean)).toHaveLength(0);
  });

  it("an accuracy above 10 km is masked", () => {
    const points = [...walk(0, 2), obs(150, SEOUL, { accuracyM: 10_001 }), ...walk(3, 2)];
    expect(anomalyMask(points)).toEqual([false, false, true, false, false]);
  });

  it("a fix at null island is masked", () => {
    const points = [...walk(0, 2), obs(150, { lat: 0, lon: 0 }), ...walk(3, 2)];
    expect(anomalyMask(points)).toEqual([false, false, true, false, false]);
  });

  it("a same-second jump above 1 km is a jump; a slower one at the same distance is not", () => {
    const near = { lat: SEOUL.lat + 0.02, lon: SEOUL.lon }; // ~2.2 km north
    // Same second out and back: both pairs jump, the fix between is masked.
    const sameSecond = [obs(0), obs(60), obs(60.2, near), obs(60.5), obs(120)];
    expect(anomalyMask(sameSecond)).toEqual([false, false, true, false, false]);
    // A minute each way at 2.2 km is 133 km/h: a ride, not an anomaly.
    const ride = [obs(0), obs(60), obs(120, near), obs(180), obs(240)];
    expect(anomalyMask(ride).some(Boolean)).toBe(false);
  });

  it("an airliner is not a teleport: the speed limit is at least 1000 km/h", () => {
    // ~250 m/s (900 km/h) for ten minutes, a fix every minute.
    const flight = Array.from({ length: 10 }, (_, i) =>
      obs(i * 60, { lat: SEOUL.lat - i * 0.135, lon: SEOUL.lon })
    );
    expect(anomalyMask(flight).some(Boolean)).toBe(false);
  });

  it("judges each device on its own: two phones far apart are not jumps", () => {
    const a = walk(0, 4, "phone-a");
    const b = Array.from({ length: 4 }, (_, i) => obs(i * 60 + 1, BUSAN, { deviceId: "phone-b" }));
    const interleaved = [a[0], b[0], a[1], b[1], a[2], b[2], a[3], b[3]];
    expect(anomalyMask(interleaved).some(Boolean)).toBe(false);
  });

  it("an empty read masks nothing", () => {
    expect(anomalyMask([])).toEqual([]);
  });
});

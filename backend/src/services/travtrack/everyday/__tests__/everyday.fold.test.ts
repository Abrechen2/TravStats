import { describe, it, expect } from "@jest/globals";

import type { StoredPoint } from "../../../tripRecording/segments";
import type { SafePointRow } from "../../readSafe";
import { addStretches, emptyFigures } from "../fold";
import { plausibleAltitudeM, plausibleSpeedMps } from "../plausible";

/**
 * forgejo#400 — the everyday figures abstain, drop GPS spikes by the
 * documented rule, ignore the air, and file time and kilometres under the
 * phone's own movement class.
 */

const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);
const LON_PER_M = 1 / (111_320 * Math.cos((50 * Math.PI) / 180));

type Spec = {
  speed?: number | null;
  alt?: number | null;
  motion?: string | null;
  purpose?: string;
};

/** A stretch heading east at `mps`, one fix every `everyS` seconds. */
function stretch(
  n: number,
  mps: number,
  everyS: number,
  specs: (i: number) => Spec = () => ({})
): { points: StoredPoint[]; rowOf: (p: StoredPoint) => SafePointRow | undefined } {
  const rows = new Map<StoredPoint, SafePointRow>();
  const points: StoredPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p: StoredPoint = [T0 + i * everyS * 1000, 50, 8 + mps * everyS * i * LON_PER_M, 5];
    const s = specs(i);
    rows.set(p, {
      id: `p${i}`,
      t: new Date(p[0]),
      lat: p[1],
      lon: p[2],
      accuracyM: 5,
      altitudeM: s.alt ?? null,
      speedMps: s.speed ?? null,
      course: null,
      motion: s.motion ?? null,
      deviceId: "d",
      origin: "companion:d",
      purpose: s.purpose ?? "everyday",
      seq: BigInt(i),
    });
    points.push(p);
  }
  return { points, rowOf: (p) => rows.get(p) };
}

const never = () => false;

describe("everyday figures", () => {
  it("abstain: no reported speed, altitude or motion is null / empty, never 0", () => {
    const { points, rowOf } = stretch(10, 5, 10);
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.topSpeed).toBeNull();
    expect(f.highest).toBeNull();
  });

  it("drops a lone GPS speed spike, keeps the believable top speed", () => {
    // Walking pace (1.5 m/s), one fix claims 60 m/s with nothing around it moving that fast.
    const { points, rowOf } = stretch(20, 1.5, 10, (i) => ({
      speed: i === 7 ? 60 : 1.5,
      motion: i === 7 ? null : "walking",
    }));
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.topSpeed?.mps).toBe(1.5);
  });

  it("keeps a real fast stretch: a corroborated 30 m/s drive is the top speed", () => {
    const { points, rowOf } = stretch(20, 30, 10, () => ({ speed: 30, motion: "automotive" }));
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.topSpeed?.mps).toBe(30);
  });

  it("a fast fix with no neighbour close enough cannot be corroborated and is dropped", () => {
    const { points, rowOf } = stretch(3, 1, 600, () => ({ speed: 40 }));
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.topSpeed).toBeNull();
  });

  it("a bad-fix neighbour cannot vouch for a speed spike", () => {
    const { points, rowOf } = stretch(3, 40, 60, (i) => ({ speed: i === 1 ? 60 : null }));
    // The outer fixes are 10 km-accuracy garbage whose positions happen to jump fast.
    const bad: StoredPoint[] = points.map((p, i) => (i === 1 ? p : [p[0], p[1], p[2], 20_000]));
    const rows = new Map(points.map((p, i) => [bad[i], rowOf(p)!]));
    const f = addStretches(emptyFigures(), [bad], (p) => rows.get(p), never);
    expect(f.topSpeed).toBeNull();
  });

  it("refuses an impossible speed, a contradicting class and a poor accuracy", () => {
    expect(plausibleSpeedMps({ speedMps: 400, accuracyM: 5, motion: null })).toBeNull();
    expect(plausibleSpeedMps({ speedMps: -1, accuracyM: 5, motion: null })).toBeNull();
    expect(plausibleSpeedMps({ speedMps: 20, accuracyM: 5, motion: "walking" })).toBeNull();
    expect(plausibleSpeedMps({ speedMps: 20, accuracyM: 500, motion: null })).toBeNull();
    expect(plausibleSpeedMps({ speedMps: 20, accuracyM: 5, motion: "automotive" })).toBe(20);
  });

  it("an aircraft's speed and altitude never count: in a flight window or recorded for a flight", () => {
    const air = stretch(20, 200, 10, () => ({ speed: 200 / 1, alt: 10_000 }));
    const inWindow = (p: StoredPoint) => p[0] >= T0 && p[0] <= T0 + 3_600_000;
    expect(addStretches(emptyFigures(), [air.points], air.rowOf, inWindow).topSpeed).toBeNull();
    const flagged = stretch(20, 30, 10, () => ({ speed: 30, alt: 800, purpose: "flight" }));
    const f = addStretches(emptyFigures(), [flagged.points], flagged.rowOf, never);
    expect(f.topSpeed).toBeNull();
    expect(f.highest).toBeNull();
  });

  it("the highest point is median-smoothed: one spiking altitude is not the maximum", () => {
    const { points, rowOf } = stretch(15, 1, 10, (i) => ({ alt: i === 6 ? 4000 : 500 + i }));
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.highest?.m).toBeLessThan(520);
    expect(f.highest?.m).toBeGreaterThan(500);
  });

  it("an altitude outside the earth's range is no altitude", () => {
    expect(plausibleAltitudeM({ altitudeM: 12_000, accuracyM: 5 })).toBeNull();
    expect(plausibleAltitudeM({ altitudeM: -9_999, accuracyM: 5 })).toBeNull();
    expect(plausibleAltitudeM({ altitudeM: 2_962, accuracyM: 5 })).toBe(2_962);
  });

  it("files time and kilometres under the class the phone reported; a long gap counts for none", () => {
    // 10 fixes walking (10 s apart, 1.5 m/s) then 10 driving (10 s apart, 20 m/s).
    const rowsFor = (i: number): Spec =>
      i < 10 ? { motion: "walking" } : { motion: "automotive" };
    const { points, rowOf } = stretch(20, 1.5, 10, rowsFor);
    const f = addStretches(emptyFigures(), [points], rowOf, never);
    expect(f.byMotion.walking.ms).toBeGreaterThan(80_000);
    expect(f.byMotion.automotive.ms).toBeGreaterThan(0);
    expect(f.byMotion.cycling).toEqual({ ms: 0, km: 0 });
    const gap = stretch(2, 1, 3600, () => ({ motion: "walking" }));
    const g = addStretches(emptyFigures(), [gap.points], gap.rowOf, never);
    expect(g.byMotion.walking.ms).toBe(0);
  });
});

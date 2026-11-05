import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import type { SafePointRow, SafeSpan } from "../readSafe";

/**
 * A day recorded only with coarse fixes (> 1000 m) still gets legs, but its
 * figures claim no pace (a phone lying still "moves" by its own error); a day
 * that also holds finer fixes is unchanged (coarse ones stay ignored).
 */

const MIN = 60_000;
const T0 = Date.parse("2026-10-12T08:00:00Z");
const M = 111_195;

function read(accuracies: number[], metresPerMin: number): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segment = accuracies.map((acc, i): StoredPoint => {
    const p: StoredPoint = [T0 + i * MIN, 37.5 + (i * metresPerMin) / M, 127, acc];
    rows.set(p, {
      id: `p${i}`,
      t: new Date(p[0]),
      lat: p[1],
      lon: p[2],
      accuracyM: acc,
      altitudeM: null,
      speedMps: metresPerMin / 60,
      course: null,
      motion: "automotive",
      deviceId: "d",
      origin: "companion:d",
      purpose: "everyday",
      seq: BigInt(i),
    });
    return p;
  });
  return {
    segments: [segment],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as SafeSpan;
}

const inputs = { windows: [], overrides: [], stays: [] };

describe("deriveLegs on coarse fixes", () => {
  it("a coarse-only day gets a leg, with mode unknown and no invented speed (was: no leg at all)", () => {
    const { legs } = deriveLegs(read(Array(11).fill(1500), 900), inputs);
    expect(legs).toHaveLength(1);
    expect(legs[0].distanceM).toBeGreaterThan(8000);
    expect(legs[0]).toMatchObject({
      mode: "unknown",
      confidence: "low",
      avgSpeedMps: null,
      maxSpeedMps: null,
      movingMs: null,
    });
  });

  it("a mixed day is unchanged: coarse fixes beside fine ones are still ignored", () => {
    const acc = [5, 5, 1500, 5, 5, 5, 2500, 5, 5, 5, 5];
    const { legs } = deriveLegs(read(acc, 900), inputs);
    // Pinned from the behaviour before the coarse-only rule: bad fixes cut the line, and the
    // pieces keep their pace figures.
    expect(legs.map((l) => [l.mode, l.distanceM])).toEqual([
      ["unknown", 900],
      ["car", 1800],
      ["car", 2700],
    ]);
    expect(legs.every((l) => l.avgSpeedMps !== null && l.maxSpeedMps !== null)).toBe(true);
  });
});

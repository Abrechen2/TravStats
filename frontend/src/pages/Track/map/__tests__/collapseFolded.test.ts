import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import { collapseFolded } from "../collapseFolded";

const fix = (min: number, lat: number, lon: number): TrackPoint => [min * 60_000, lat, lon, 5];

describe("collapseFolded", () => {
  it("draws a folded stop as its place point: no vertex inside the span survives (GPS wander hidden)", () => {
    const segment = [
      fix(0, 50, 10),
      fix(10, 50.001, 10), // arrives
      fix(12, 50.0011, 10.0002), // wander inside the circle
      fix(15, 50.0009, 9.9998),
      fix(20, 50.0012, 10.0001),
      fix(30, 50.01, 10.01), // leaves
    ];
    const span = { fromMs: 10 * 60_000, untilMs: 20 * 60_000, lat: 50.001, lon: 10 };
    const [line] = collapseFolded([segment], [span]);
    expect(line.map((p) => p[0] / 60_000)).toEqual([0, 10, 20, 30]);
    expect(line[1]).toEqual([600_000, 50.001, 10, null]);
    expect(line[2]).toEqual([1_200_000, 50.001, 10, null]);
    expect(line.some((p) => p === segment[2] || p === segment[3])).toBe(false);
  });

  it("leaves segments alone where no stop is folded, and never mutates its input", () => {
    const segment = [fix(0, 50, 10), fix(5, 50.01, 10)];
    const copy = JSON.stringify(segment);
    expect(collapseFolded([segment], [])).toEqual([segment]);
    collapseFolded([segment], [{ fromMs: 0, untilMs: 1, lat: 0, lon: 0 }]);
    expect(JSON.stringify(segment)).toBe(copy);
  });
});

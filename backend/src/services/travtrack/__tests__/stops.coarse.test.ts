import type { StoredPoint } from "../../tripRecording/segments";
import { withoutBadVertices } from "../drawnFixes";
import { findDwells } from "../legs/stops";

/**
 * Dwell detection follows the drawn read: a coarse fix is dropped only where a
 * finer one exists in the stretch (`badVertexIn`, shared with `drawnFixes.ts`).
 */

const MIN = 60_000;
const T0 = Date.parse("2026-10-12T08:00:00Z");
const fix = (min: number, lonDeg: number, acc: number | null): StoredPoint => [
  T0 + min * MIN,
  50,
  10 + lonDeg,
  acc,
];
// 20 minutes at one spot, then a ride away
const still = (acc: number) => [0, 5, 10, 15, 20].map((m) => fix(m, 0, acc));
const away = (acc: number) => [25, 30].map((m, i) => fix(m, 0.05 * (i + 1), acc));

describe("findDwells on coarse fixes", () => {
  it("finds the stop of a day recorded ONLY with coarse fixes (was: no stops at all)", () => {
    const day = [...still(1500), ...away(1500)];
    expect(findDwells(day)).toEqual([{ from: 0, to: 4 }]);
  });

  it("a mixed day is unchanged: coarse fixes are still ignored beside fine ones", () => {
    // a coarse fix 2 km off in the middle of the dwell must neither break it nor end it
    const day = [
      fix(0, 0, 5),
      fix(5, 0, 5),
      fix(10, 0.03, 2500),
      fix(15, 0, 5),
      fix(20, 0, 5),
      ...away(5),
    ];
    expect(findDwells(day)).toEqual([{ from: 0, to: 4 }]);
  });

  it("a coarse fix is still bad beside fine ones: a coarse-only dwell is not invented", () => {
    const day = [fix(0, 0, 5), fix(1, 0, 5), ...[5, 10, 15, 20].map((m) => fix(m, 0, 3000))];
    expect(findDwells(day)).toEqual([]);
  });

  it("agrees with the drawn read: the fixes dwell detection sees are the ones drawn", () => {
    const coarseOnly = [...still(1500), ...away(1500)];
    const drawn = withoutBadVertices({ segments: [coarseOnly], circles: [] }).segments[0];
    expect(drawn).toEqual(coarseOnly);
    const mixed = [fix(0, 0, 5), fix(5, 0.03, 2500), fix(10, 0, 5)];
    expect(withoutBadVertices({ segments: [mixed], circles: [] }).segments[0]).toHaveLength(2);
  });
});

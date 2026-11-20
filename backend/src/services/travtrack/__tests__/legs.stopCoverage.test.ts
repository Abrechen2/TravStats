import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import { clipStops } from "../legs";
import type { SafePointRow, SafeSpan } from "../readSafe";

/** A stay joined across a silence must say which part was measured and which assumed. Synthetic spot. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const M = 111_195;
const SPOT = { lat: 47.5, lon: 11.0 };
const T0 = Date.parse("2026-11-10T18:00:00Z");

type Fix = [t: number, northM: number];

function read(stretches: Fix[][]): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segments = stretches.map((fixes, s) =>
    fixes.map(([t, dN], i): StoredPoint => {
      const p: StoredPoint = [t, SPOT.lat + dN / M, SPOT.lon, 5];
      rows.set(p, {
        id: `p${s}-${i}`,
        t: new Date(t),
        deviceId: "d",
        accuracyM: 5,
      } as SafePointRow);
      return p;
    })
  );
  return {
    segments,
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as unknown as SafeSpan;
}
const inputs = { windows: [], overrides: [], stays: [] };
/** Twenty minutes of fixes every five minutes at the spot, from `start`. */
const dense = (start: number): Fix[] => [0, 5, 10, 15, 20].map((m, i): Fix => [start + m * MIN, i]);

describe("a stay across a recording silence reports measured and assumed time apart", () => {
  const afterGap = T0 + 10 * HOUR;
  const { stops } = deriveLegs(read([dense(T0), dense(afterGap)]), inputs);

  it("joins the two stretches into one stop (the existing behaviour)", () => {
    expect(stops).toHaveLength(1);
    expect(stops[0].untilMs).toBe(afterGap + 20 * MIN);
  });

  it("names the silence as a gap and splits the duration (was: no coverage field, the whole stay read as measured)", () => {
    const c = stops[0].coverage;
    expect(c).toBeDefined();
    expect(c!.gaps).toEqual([{ fromMs: T0 + 20 * MIN, untilMs: afterGap }]);
    expect(c!.inferredMs).toBe(afterGap - (T0 + 20 * MIN));
    expect(c!.observedMs).toBe(40 * MIN);
    expect(c!.observedMs + c!.inferredMs).toBe(stops[0].untilMs - stops[0].fromMs);
  });

  it("a stop with no silence inside carries no coverage", () => {
    const solo = deriveLegs(read([dense(T0)]), inputs).stops;
    expect(solo).toHaveLength(1);
    expect(solo[0].coverage).toBeUndefined();
  });

  it("clipped to a day, the gap and both figures follow the clip", () => {
    const cut = T0 + 5 * HOUR;
    const [clipped] = clipStops(stops, { fromMs: cut, untilMs: cut + 24 * HOUR });
    expect(clipped.coverage!.gaps).toEqual([{ fromMs: cut, untilMs: afterGap }]);
    expect(clipped.coverage!.observedMs + clipped.coverage!.inferredMs).toBe(
      clipped.untilMs - clipped.fromMs
    );
  });
});

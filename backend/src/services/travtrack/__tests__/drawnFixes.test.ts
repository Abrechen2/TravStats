import type { StoredPoint } from "../../tripRecording/segments";
import { withoutBadVertices } from "../drawnFixes";

/**
 * The drawn read: coarse fallback fixes are dropped where finer ones exist,
 * the privacy cut is applied again on what is left, and a day of only coarse
 * fixes is still drawn.
 */

const zone = { lat: 50, lon: 10, radiusM: 200 };
const at = (t: number, lat: number, lon: number, acc: number | null): StoredPoint => [
  t,
  lat,
  lon,
  acc,
];
const read = (segments: StoredPoint[][], circles = [zone]) =>
  ({ segments, circles }) as Parameters<typeof withoutBadVertices>[0];

describe("withoutBadVertices", () => {
  it("drops a coarse fix when finer fixes exist, keeps the same tuples", () => {
    const a = at(1, 50.5, 9.5, 5);
    const b = at(2, 50.5, 9.6, 2500);
    const c = at(3, 50.5, 9.7, 8);
    const out = withoutBadVertices(read([[a, b, c]], []));
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0][0]).toBe(a);
    expect(out.segments[0][1]).toBe(c);
    expect(out.segments[0]).toHaveLength(2);
  });

  it("a day whose fixes are ALL coarse still draws them (it must not go blank)", () => {
    const a = at(1, 50.5, 9.5, 1500);
    const b = at(2, 50.5, 9.6, 2500);
    const out = withoutBadVertices(read([[a, b]], []));
    expect(out.segments).toEqual([[a, b]]);
  });

  it("never draws null island, even on an all-coarse day", () => {
    const a = at(1, 0, 0, 5);
    const b = at(2, 50.5, 9.6, 2500);
    expect(withoutBadVertices(read([[a, b]], [])).segments).toEqual([[b]]);
  });

  it("a coarse-only stretch beside a fine one is dropped as a spike", () => {
    const fine = [at(1, 50.5, 9.5, 5), at(2, 50.5, 9.51, 5)];
    const spike = [at(3, 50.6, 9.5, 3000)];
    expect(withoutBadVertices(read([fine, spike], [])).segments).toEqual([fine]);
  });

  it("re-applies the privacy cut: a chord across a zone that only exists once a bad vertex is gone does not come back", () => {
    // A and C lie either side of the zone; the coarse B between them kept both chords clear of it.
    const a = at(1, 50, 9.99, 5);
    const b = at(2, 50.05, 10, 2500);
    const c = at(3, 50, 10.01, 5);
    const out = withoutBadVertices(read([[a, b, c]]));
    // The chord A-C crosses the zone, so no stretch may join them.
    expect(out.segments.some((s) => s.includes(a) && s.includes(c))).toBe(false);
  });
});

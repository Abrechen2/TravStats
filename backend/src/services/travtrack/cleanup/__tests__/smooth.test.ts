import type { StoredPoint } from "../../../tripRecording/segments";
import { SMOOTH_DEFAULTS, smoothSegment, smoothSegments } from "../smooth";

/**
 * The smoothing table (rc46 extras C1): a speed-gated moving median, checked
 * by hand. One minute between fixes; 0.001° of latitude is about 111 m.
 */
const MIN = 60_000;
const p = (min: number, lat: number, lon = 8): StoredPoint => [min * MIN, lat, lon, 50];

describe("smoothSegment — speed-gated moving median", () => {
  it.each([
    [
      "a lone spike is pulled back onto its neighbours",
      [p(0, 50), p(1, 50.001), p(2, 50.02), p(3, 50.003), p(4, 50.004)],
      [50, 50.001, 50.003, 50.004, 50.004],
    ],
    [
      "a straight walk stays a straight walk",
      [p(0, 50), p(1, 50.001), p(2, 50.002), p(3, 50.003), p(4, 50.004)],
      [50, 50.001, 50.002, 50.003, 50.004],
    ],
    [
      "zigzag jitter flattens to the median",
      [p(0, 50), p(1, 50.0004), p(2, 49.9996), p(3, 50.0004), p(4, 50)],
      [50, 50, 50, 50, 50],
    ],
  ])("%s", (_name, input, lats) => {
    expect(smoothSegment(input).map((q) => q[1])).toEqual(lats);
  });

  it("leaves fast travel exactly as recorded (the gate)", () => {
    // ~0.1° a minute = ~185 m/s: a plane, not jitter.
    const plane = [p(0, 50), p(1, 50.1), p(2, 50.25), p(3, 50.3), p(4, 50.4)];
    expect(smoothSegment(plane)).toEqual(plane);
  });

  it("never moves a segment's first or last fix", () => {
    const out = smoothSegment([p(0, 50.5), p(1, 50), p(2, 50), p(3, 50), p(4, 49.5)]);
    expect([out[0][1], out[4][1]]).toEqual([50.5, 49.5]);
  });

  it("does not reach across a pause longer than the window", () => {
    const far = SMOOTH_DEFAULTS.windowMs / MIN + 5;
    const input = [p(0, 50), p(far, 50.02), p(far * 2, 50)];
    expect(smoothSegment(input)).toEqual(input);
  });

  it("keeps time and accuracy, and does not change its input", () => {
    const input = [p(0, 50), p(1, 50.001), p(2, 50.02), p(3, 50.003), p(4, 50.004)];
    const copy = JSON.parse(JSON.stringify(input));
    const out = smoothSegments([input]);
    expect(input).toEqual(copy);
    expect(out[0].map((q) => [q[0], q[3]])).toEqual(input.map((q) => [q[0], q[3]]));
  });
});

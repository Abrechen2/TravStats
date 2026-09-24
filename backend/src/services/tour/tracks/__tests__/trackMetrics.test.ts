import { climbAndDescent, movingSeconds } from "../trackMetrics";

describe("climbAndDescent", () => {
  it("measures a clean climb and descent", () => {
    expect(climbAndDescent([270, 350, 480, 604, 500, 270])).toEqual({
      ascentM: 334,
      descentM: 334,
    });
  });

  it("does not turn GPS noise on a flat walk into a climb", () => {
    // ±2 m jitter around 100 m for 500 points: summing every positive delta
    // would report roughly a kilometre of climbing on a flat promenade.
    const noisy = Array.from({ length: 500 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -2));
    const { ascentM, descentM } = climbAndDescent(noisy)!;
    expect(ascentM).toBeLessThan(10);
    expect(descentM).toBeLessThan(10);
  });

  it("keeps a small real climb that simplification would cut", () => {
    // A 12 m bump is exactly what a hike is made of, and bigger than the band.
    expect(climbAndDescent([100, 104, 108, 112, 108, 104, 100])).toEqual({
      ascentM: 12,
      descentM: 12,
    });
  });

  it("skips missing readings instead of treating them as sea level", () => {
    expect(climbAndDescent([500, null, 520, null, 540])).toEqual({ ascentM: 40, descentM: 0 });
  });

  it("abstains when fewer than two readings exist", () => {
    expect(climbAndDescent([null, 300, null])).toBeNull();
    expect(climbAndDescent([])).toBeNull();
  });

  it("does not count a climb across a recording gap", () => {
    // Segment 1 ends at 100 m, segment 2 starts at 900 m (the next day, up the
    // mountain by cable car). The 800 m between them were never walked.
    expect(climbAndDescent([100, 110, 900, 910], [0, 2])).toEqual({ ascentM: 20, descentM: 0 });
  });
});

describe("movingSeconds", () => {
  const start = Date.parse("2026-07-15T08:00:00Z");
  const at = (s: number) => start + s * 1000;

  it("sums only the intervals that moved", () => {
    // 0→60 s walks 100 m (moving), 60→660 s stands still (a ten-minute break),
    // 660→720 s walks another 100 m.
    const points: Array<[number, number]> = [
      [6.19, 58.98],
      [6.19, 58.9809],
      [6.19, 58.9809],
      [6.19, 58.9818],
    ];
    expect(movingSeconds(points, [at(0), at(60), at(660), at(720)])).toBe(120);
  });

  it("does not count a recording gap as moving", () => {
    const points: Array<[number, number]> = [
      [6.19, 58.98],
      [6.19, 58.9809],
      [6.3, 59.1],
      [6.3, 59.1009],
    ];
    expect(movingSeconds(points, [at(0), at(60), at(7200), at(7260)], [0, 2])).toBe(120);
  });

  it("abstains when the points carry no times", () => {
    const points: Array<[number, number]> = [
      [6.19, 58.98],
      [6.19, 58.9809],
    ];
    expect(movingSeconds(points, [null, null])).toBeNull();
    expect(movingSeconds(points, undefined)).toBeNull();
  });
});

import {
  climbToCruiseMinutes,
  downsample,
  landingOf,
  takeoffOf,
  type FlightSample,
} from "../flightSeries";

/**
 * The flight panel's series arithmetic (owner 2026-10-26, "den kompletten Flug
 * zeigen"): the climb counts from the take-off, not from the window's start,
 * and the thinning keeps the apex and the top speed and never spans a break.
 */

const MIN = 60_000;
const s = (minute: number, alt: number | null, speed: number | null): FlightSample => [
  minute * MIN,
  alt,
  speed,
];

describe("take-off, landing and the climb", () => {
  it("the climb counts from the take-off, not from the taxi before it", () => {
    const series = [
      [
        s(0, 450, 5), // gate
        s(20, 450, 8), // taxi
        s(30, 460, 75), // rolling past rotation: take-off
        s(40, 6000, 200),
        s(55, 11000, 240),
        s(60, 11050, 245),
      ],
    ];
    expect(takeoffOf(series)?.tMs).toBe(30 * MIN);
    expect(climbToCruiseMinutes(series)).toBe(25);
  });

  it("without speeds the take-off is 300 m above the ground the stretch began on", () => {
    const series = [[s(0, 100, null), s(5, 350, null), s(8, 450, null), s(20, 10000, null)]];
    expect(takeoffOf(series)?.tMs).toBe(8 * MIN);
    expect(climbToCruiseMinutes(series)).toBe(12);
  });

  it("the climb ends at the first level-off; a later step climb is cruise (LH719, beta.29 UAT)", () => {
    const series = [
      [
        s(0, 450, 5),
        s(10, 460, 75), // take-off
        s(30, 9000, 220),
        s(47, 10500, 240), // levelled, 37 min after take-off
        s(60, 10520, 245),
        s(120, 10510, 245),
        s(290, 11000, 245), // step climb hours later
        s(303, 11500, 245), // old rule: first sample at 90 % of the apex — 293 min
        s(380, 12500, 240),
        s(400, 12510, 240),
      ],
    ];
    expect(climbToCruiseMinutes(series)).toBe(37);
  });

  it("an ATC level inside the climb is not the cruise when the aircraft climbs on soon (LH719, beta.31 UAT)", () => {
    const series = [
      [
        s(-5, 450, 5),
        s(0, 460, 75), // take-off
        s(10, 6065, 200),
        s(18, 8727, 220),
        s(22, 8717, 225),
        s(28, 8709, 225), // held 10 min at 69 % of the apex
        s(32, 10213, 235),
        s(36, 10737, 240),
        s(42, 10742, 240),
        s(60, 10679, 240),
      ],
    ];
    expect(climbToCruiseMinutes(series)).toBe(36);
  });

  it("missing altitudes never confirm a level-off (Codex)", () => {
    const series = [
      [
        s(0, 450, 5),
        s(5, 460, 75), // take-off
        s(20, 7000, 200),
        s(22, null, 210),
        s(25, null, 220),
        s(35, 11000, 240),
        s(45, 11020, 240),
      ],
    ];
    expect(climbToCruiseMinutes(series)).toBe(30);
  });

  it("a short hold low in the climb is not the cruise", () => {
    const series = [
      [
        s(0, 450, 5),
        s(5, 460, 75), // take-off
        s(15, 4000, 160),
        s(25, 4050, 160), // ten minutes held at 4,000 m (< 60 % of the apex)
        s(40, 11000, 240),
        s(50, 11020, 240),
      ],
    ];
    expect(climbToCruiseMinutes(series)).toBe(35);
  });

  it("abstains: a series starting in the air has no take-off and no climb", () => {
    const series = [[s(0, 9000, null), s(5, 10000, null)]];
    expect(takeoffOf(series)).toBeNull();
    expect(climbToCruiseMinutes(series)).toBeNull();
    expect(takeoffOf([[s(0, 9000, 230), s(5, 10000, 240)]])).toBeNull();
  });

  it("abstains when the climb is broken before cruise", () => {
    const series = [
      [s(0, 100, 10), s(5, 200, 80), s(10, 3000, 150)],
      [s(40, 10500, 240), s(50, 10600, 240)],
    ];
    expect(takeoffOf(series)?.tMs).toBe(5 * MIN);
    expect(climbToCruiseMinutes(series)).toBeNull();
  });

  it("the landing is the last airborne sample before the ground at the end", () => {
    const series = [
      [s(0, 100, 5), s(5, 300, 80), s(300, 10000, 240), s(400, 400, 70), s(405, 30, 20)],
    ];
    expect(landingOf(series)).toBe(400 * MIN);
    expect(landingOf([[s(0, 10000, 240), s(5, 10100, 240)]])).toBeNull();
  });
});

describe("downsample", () => {
  /** A 12-hour cruise at one sample a second, with one spike at 06:00:01. */
  function longHaul(): FlightSample[][] {
    const run: FlightSample[] = [];
    for (let i = 0; i < 12 * 3600; i++) {
      const alt = i === 6 * 3600 + 1 ? 12562 : 11000 + (i % 7);
      const speed = i === 3 * 3600 + 5 ? 310 : 240;
      run.push([i * 1000, alt, speed]);
    }
    return [run];
  }

  it("keeps at most 2000 samples and the apex and the top speed survive", () => {
    const out = downsample(longHaul());
    const flat = out.flat();
    expect(flat.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...flat.map((x) => x[1] ?? 0))).toBe(12562);
    expect(Math.max(...flat.map((x) => x[2] ?? 0))).toBe(310);
    // Still in time order.
    expect(flat.every((x, i) => i === 0 || x[0] > flat[i - 1][0])).toBe(true);
  });

  it("never spans a break: each stretch is thinned on its own and stays a stretch", () => {
    const a: FlightSample[] = Array.from({ length: 3000 }, (_, i) => [i * 1000, 10000, 240]);
    const b: FlightSample[] = Array.from({ length: 3000 }, (_, i) => [
      (5000 + i) * 1000,
      9000,
      230,
    ]);
    const out = downsample([a, b]);
    expect(out).toHaveLength(2);
    expect(out[0].every((x) => x[0] < 3000 * 1000)).toBe(true);
    expect(out[1].every((x) => x[0] >= 5000 * 1000)).toBe(true);
    expect(out.flat().length).toBeLessThanOrEqual(2000);
  });

  it("each stretch keeps its first and last sample, even with a flat tail", () => {
    const flat: FlightSample[] = Array.from({ length: 9000 }, (_, i) => [i * 1000, 11000, 240]);
    const out = downsample([flat]);
    expect(out[0][0]).toEqual(flat[0]);
    expect(out[0][out[0].length - 1]).toEqual(flat[flat.length - 1]);
    expect(out.flat().length).toBeLessThanOrEqual(2000);
  });

  it("leaves a short series untouched", () => {
    const series = [[s(0, 100, 5), s(1, 200, 80)]];
    expect(downsample(series)).toEqual(series);
  });

  it("the bound holds even for thousands of tiny stretches", () => {
    const many: FlightSample[][] = Array.from({ length: 5000 }, (_, i) => [
      [i * 1000, 100, 5],
      [i * 1000 + 10, 120, 6],
    ]);
    const out = downsample(many).flat();
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out[out.length - 1]).toEqual(many[many.length - 1][1]);
  });
});

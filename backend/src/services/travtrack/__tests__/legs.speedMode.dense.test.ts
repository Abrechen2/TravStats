import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import { speedWindows, topWindowSpeedMps } from "../legs/windowSpeed";
import type { SafePointRow, SafeSpan } from "../readSafe";

/**
 * Dense (about 1 Hz) fixes with no motion class and no reported speed, the
 * shape of a real iPhone day: step speeds are noise, window speeds are not.
 * The fixtures are synthetic; each reproduces the shape of a measured leg.
 */

const T0 = Date.parse("2026-10-12T00:00:00Z");
const M_PER_DEG = 111_195;

/** Deterministic noise in [-1, 1). */
const noise = (i: number, salt: number) =>
  Math.sin(i * 12.9898 + salt * 78.233) * 2 - 1 > 0
    ? Math.abs(Math.sin(i * 7.31 + salt))
    : -Math.abs(Math.sin(i * 3.17 + salt));

type Phase = { seconds: number; mps: number };

function dense(phases: Phase[], accuracyM: number, jitterM: number, glitchEvery = 0): SafeSpan {
  const points: StoredPoint[] = [[T0, 37.5, 127, accuracyM]];
  let t = 0;
  let along = 0;
  let i = 0;
  for (const ph of phases) {
    for (let s = 0; s < ph.seconds; s++, i++) {
      t += 1;
      along += ph.mps;
      const glitch = glitchEvery > 0 && i % glitchEvery === 0 ? 40 : 0;
      const lat = 37.5 + (along + glitch + jitterM * noise(i, 1)) / M_PER_DEG;
      const lon = 127 + (jitterM * noise(i, 2)) / M_PER_DEG;
      points.push([T0 + t * 1000, lat, lon, accuracyM]);
    }
  }
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  points.forEach((p, k) =>
    rows.set(p, {
      id: `p${k}`,
      t: new Date(p[0]),
      lat: p[1],
      lon: p[2],
      accuracyM: p[3],
      altitudeM: null,
      speedMps: null,
      course: null,
      motion: null,
      deviceId: "d",
      origin: "companion:d",
      purpose: "everyday",
      seq: BigInt(k),
    })
  );
  return {
    segments: [points],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as SafeSpan;
}

const run = (span: SafeSpan) => deriveLegs(span, { windows: [], overrides: [], stays: [] }).legs;
const drive = (): Phase[] => {
  const out: Phase[] = [];
  for (let k = 0; k < 6; k++)
    out.push({ seconds: 120, mps: 14 }, { seconds: 60, mps: 0.1 }, { seconds: 90, mps: 3 });
  return out;
};

describe("deriveLegs — speed fallback on dense, noisy fixes", () => {
  it("a city drive with stop-and-go at 1 Hz is a car, low confidence (its p25 is a red light)", () => {
    const legs = run(dense(drive(), 5, 4));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: "car", modeSource: "auto", confidence: "low" });
  });

  it("a 40-minute walk at 20 m accuracy with 1 s glitches is a walk, not unknown", () => {
    const legs = run(dense([{ seconds: 2400, mps: 1.0 }], 20, 12, 97));
    expect(legs[0]).toMatchObject({ mode: "walk", confidence: "low" });
  });

  it("a walk with a few 40 m glitches never becomes a car", () => {
    const legs = run(dense([{ seconds: 1800, mps: 1.2 }], 15, 8, 40));
    expect(legs[0].mode).not.toBe("car");
  });

  it("a long walk then a short drive without a stop is unknown", () => {
    const legs = run(
      dense(
        [
          { seconds: 1800, mps: 1.3 },
          { seconds: 200, mps: 15 },
        ],
        5,
        3
      )
    );
    expect(legs[0].mode).toBe("unknown");
  });

  it("leg maxSpeedMps without reported speed is the glitch-safe window speed, not a 1 s spike", () => {
    const span = dense([{ seconds: 1200, mps: 1.2 }], 15, 8, 50);
    const [leg] = run(span);
    expect(leg.maxSpeedMps).not.toBeNull();
    expect(leg.maxSpeedMps!).toBeLessThan(4);
    expect(leg.maxSpeedMps!).toBeGreaterThan(0.5);
  });

  it("a car drive reports its cruising speed as max speed on a day without speed fields", () => {
    const [leg] = run(dense(drive(), 5, 4));
    expect(leg.maxSpeedMps!).toBeGreaterThan(11);
    expect(leg.maxSpeedMps!).toBeLessThan(17);
  });
});

describe("speedWindows", () => {
  it("stands still windows are closed at the cap, and a gap restarts the window", () => {
    const pts: StoredPoint[] = [
      [T0, 37.5, 127, 20],
      [T0 + 100_000, 37.5, 127, 20],
      [T0 + 100_000 + 20 * 60_000, 37.5, 127, 20],
    ];
    expect(speedWindows(pts)).toHaveLength(1);
    expect(topWindowSpeedMps(pts)).toBe(0);
  });
});

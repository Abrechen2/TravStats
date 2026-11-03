import type { EntryWindow } from "../../locationEvidence/journeys/entryWindows";
import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import type { SafePointRow, SafeSpan } from "../readSafe";

/**
 * The pure core of the leg derivation. A rental or roadtrip window covers days
 * of walking too, so it may name a mode only where the phone does not clearly
 * show a person on foot (spec 2026-11-03-travtrack-legs §1, refined).
 */

const MIN = 60_000;
const T0 = Date.parse("2026-10-12T00:00:00Z");
const M = 111_195;

function span(points: Array<{ min: number; m: number; speed: number; motion: string | null }>) {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segment = points.map((p): StoredPoint => {
    const point: StoredPoint = [T0 + p.min * MIN, 37.5 + p.m / M, 127, 5];
    rows.set(point, {
      id: `p${p.min}`,
      t: new Date(point[0]),
      lat: point[1],
      lon: point[2],
      accuracyM: 5,
      altitudeM: null,
      speedMps: p.speed,
      course: null,
      motion: p.motion,
      deviceId: "d",
      origin: "companion:d",
      purpose: "everyday",
      seq: BigInt(p.min),
    });
    return point;
  });
  const read = {
    segments: [segment],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as SafeSpan;
  return read;
}

const roadtrip: EntryWindow = {
  domain: "roadtrip",
  id: "rt-1",
  fromMs: T0 - 86_400_000,
  untilMs: T0 + 86_400_000,
};

const line = (n: number, speed: number, motion: string | null) =>
  Array.from({ length: n }, (_, i) => ({ min: i, m: i * speed * 60, speed, motion }));

describe("deriveLegs — broad entries (roadtrip, rental)", () => {
  it("a walk inside a roadtrip stays a walk: the entry does not paint the whole trip as a drive", () => {
    const { legs } = deriveLegs(span(line(11, 1.4, "walking")), {
      windows: [roadtrip],
      overrides: [],
      stays: [],
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: "walk", modeSource: "auto", entryRef: null });
  });

  it("a drive inside a roadtrip is the roadtrip's, with its reference", () => {
    const { legs } = deriveLegs(span(line(11, 15, "automotive")), {
      windows: [roadtrip],
      overrides: [],
      stays: [],
    });
    expect(legs[0]).toMatchObject({
      mode: "car",
      modeSource: "entry",
      entryRef: { domain: "roadtrip", id: "rt-1" },
    });
  });

  it("movement the phone cannot class becomes the roadtrip's, not unknown", () => {
    const { legs } = deriveLegs(span(line(11, 15, null)), {
      windows: [roadtrip],
      overrides: [],
      stays: [],
    });
    expect(legs[0]).toMatchObject({ mode: "car", modeSource: "entry" });
  });

  it("without any entry, the same unclassed movement stays unknown, with low confidence", () => {
    const { legs } = deriveLegs(span(line(11, 15, null)), {
      windows: [],
      overrides: [],
      stays: [],
    });
    expect(legs[0]).toMatchObject({ mode: "unknown", modeSource: "auto", confidence: "low" });
  });

  it("a short wobble of another class does not cut a walk in two", () => {
    const pts = line(21, 1.4, "walking");
    // Two minutes the phone calls running at a pace that fits.
    pts[10] = { ...pts[10], motion: "running", speed: 2 };
    const { legs } = deriveLegs(span(pts), { windows: [], overrides: [], stays: [] });
    expect(legs).toHaveLength(1);
    expect(legs[0].mode).toBe("walk");
  });
});

describe("deriveLegs — a manual mode decides the figures", () => {
  it("a leg corrected to flight keeps the distance and time of its fast step (flight rules, no ground-speed cap)", () => {
    const pts = [
      { min: 0, m: 0, speed: 2, motion: null },
      { min: 1, m: 111, speed: 2, motion: null },
      { min: 2, m: 111 + 12_120, speed: 200, motion: null },
    ];
    const run = (
      overrides: Array<{ fromMs: number; untilMs: number; mode: "flight"; updatedAtMs: number }>
    ) => deriveLegs(span(pts), { windows: [], overrides, stays: [] }).legs;
    const manual = run([{ fromMs: T0, untilMs: T0 + 2 * MIN, mode: "flight", updatedAtMs: 1 }]);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ mode: "flight", modeSource: "manual" });
    expect(manual[0].distanceM).toBeGreaterThan(12_000);
    expect(manual[0].movingMs).toBeGreaterThan(0);
  });
});

import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import {
  CAR_FAST_MIN_MS,
  CYCLE_P95_MAX_MPS,
  SPEED_MIN_MOVING_MS,
  SPEED_MIN_STEPS,
  WALK_P95_MAX_MPS,
} from "../legs/speedMode";
import type { SafePointRow, SafeSpan } from "../readSafe";

/**
 * The speed-profile fallback for a leg whose points carry no motion class
 * (owner decision 2026-11-04): walk, cycle or car at low confidence, unknown
 * where the profile is ambiguous or thin.
 */

const MIN = 60_000;
const T0 = Date.parse("2026-10-12T00:00:00Z");
const M = 111_195;

type Step = { mps: number; reported?: number | null; motion?: string | null };

/** One fix per minute; step i covers `mps` metres per second for a minute. */
function read(steps: Step[], opts: { reported: boolean } = { reported: true }): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  let m = 0;
  const all: Array<{ min: number; m: number; step: Step | null }> = [{ min: 0, m: 0, step: null }];
  steps.forEach((s, i) => {
    m += s.mps * 60;
    all.push({ min: i + 1, m, step: s });
  });
  const segment = all.map(({ min, m: pos, step }): StoredPoint => {
    const point: StoredPoint = [T0 + min * MIN, 37.5 + pos / M, 127, 5];
    rows.set(point, {
      id: `p${min}`,
      t: new Date(point[0]),
      lat: point[1],
      lon: point[2],
      accuracyM: 5,
      altitudeM: null,
      speedMps: !opts.reported ? null : step ? (step.reported ?? step.mps) : 0,
      course: null,
      motion: step?.motion ?? null,
      deviceId: "d",
      origin: "companion:d",
      purpose: "everyday",
      seq: BigInt(min),
    });
    return point;
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

const run = (span: SafeSpan) => deriveLegs(span, { windows: [], overrides: [], stays: [] }).legs;
const rep = (n: number, mps: number, motion: string | null = null): Step[] =>
  Array.from({ length: n }, () => ({ mps, motion }));

describe("deriveLegs — speed-profile fallback when no point carries motion", () => {
  it("a 1 km walk with no motion is a walk, low confidence", () => {
    const legs = run(read(rep(12, 1.4)));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: "walk", modeSource: "auto", confidence: "low" });
  });

  it("a GPX-style leg with no speed at all is classed from position/time deltas", () => {
    const legs = run(read(rep(12, 1.4), { reported: false }));
    expect(legs[0]).toMatchObject({ mode: "walk", modeSource: "auto", confidence: "low" });
    const drive = run(read([...rep(20, 4.2), ...rep(5, 27.2)], { reported: false }));
    expect(drive[0]).toMatchObject({ mode: "car", confidence: "low" });
  });

  it("a 19.6 km / 66 min leg with max 98 km/h and stops is a car, low confidence", () => {
    const steps: Step[] = [];
    // 16 stationary minutes spread as traffic lights, 45 minutes of town pace, 5 minutes at 98 km/h.
    for (let i = 0; i < 45; i++) steps.push({ mps: 4.22 }, ...(i < 16 ? [{ mps: 0 }] : []));
    steps.push(...rep(5, 27.2));
    const legs = run(read(steps));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: "car", modeSource: "auto", confidence: "low" });
    expect(legs[0].distanceM).toBeGreaterThan(19_000);
    expect(legs[0].durationMs).toBe(66 * MIN);
    expect(legs[0].maxSpeedMps).toBeCloseTo(27.2, 0);
  });

  it("a bike pace (5 m/s) with a modest downhill is a cycle", () => {
    expect(run(read([...rep(20, 5), ...rep(3, 9)]))[0]).toMatchObject({
      mode: "cycle",
      confidence: "low",
    });
  });

  it("a mixed walk-then-drive profile is unknown, not a guess", () => {
    expect(run(read([...rep(10, 1.4), ...rep(10, 15)]))[0]).toMatchObject({
      mode: "unknown",
      modeSource: "auto",
      confidence: "low",
    });
  });

  it("a pace between walking and cycling is unknown", () => {
    expect(run(read(rep(12, 2.8)))[0].mode).toBe("unknown");
  });

  it("a single GPS-like spike does not turn a walk into a car or cycle", () => {
    const steps = rep(12, 1.4);
    steps[5] = { mps: 20 };
    expect(run(read(steps))[0].mode).toBe("unknown");
  });

  it("a leg with too few moving steps is unknown", () => {
    // 4 steps of 900 m at 1.4 m/s would still be a walk by pace.
    expect(SPEED_MIN_STEPS).toBe(5);
    expect(run(read(rep(SPEED_MIN_STEPS - 1, 1.4)))[0]?.mode ?? "unknown").toBe("unknown");
    expect(run(read(rep(SPEED_MIN_STEPS + 3, 1.4)))[0].mode).toBe("walk");
  });

  it("less than three minutes of moving time is unknown", () => {
    expect(SPEED_MIN_MOVING_MS).toBe(3 * MIN);
    expect(run(read(rep(2, 8)))[0]?.mode ?? "unknown").toBe("unknown");
  });

  it("walking edge: p95 just over the walk ceiling is not a walk", () => {
    expect(run(read(rep(12, WALK_P95_MAX_MPS - 0.2)))[0].mode).toBe("unknown");
    expect(run(read(rep(12, 2.1)))[0].mode).toBe("walk");
  });

  it("cycle edge: p95 over the cycle ceiling is not a cycle, and slow car-like creeping is not a car", () => {
    expect(run(read(rep(15, CYCLE_P95_MAX_MPS + 0.5)))[0].mode).toBe("unknown");
    expect(run(read(rep(15, 6.9)))[0].mode).toBe("cycle");
  });

  it("car edge: fewer than three fast fixes is a spike, three are a drive", () => {
    expect(CAR_FAST_MIN_MS).toBe(2 * MIN);
    expect(run(read([...rep(20, 4.2), ...rep(2, 27)]))[0].mode).toBe("unknown");
    expect(run(read([...rep(20, 4.2), ...rep(3, 27)]))[0].mode).toBe("car");
  });

  it("a long walk followed by a longer drive is unknown, not a car for the whole stretch", () => {
    expect(run(read([...rep(10, 1.4), ...rep(11, 15)]))[0].mode).toBe("unknown");
  });

  it("one sparse step at driving pace among slow fixes is a spike, not a car", () => {
    // One 27 m/s step among twenty at town pace.
    const steps = rep(20, 4.2);
    steps[10] = { mps: 27 };
    expect(run(read(steps))[0].mode).toBe("unknown");
  });

  it("motion-carrying legs are unchanged: a corroborated walk stays high confidence", () => {
    expect(run(read(rep(12, 1.4, "walking")))[0]).toMatchObject({
      mode: "walk",
      confidence: "high",
    });
  });

  it("a leg whose motion class the speed contradicts stays unknown (the fallback does not overrule a phone that spoke)", () => {
    // automotive at 1.4 m/s: the phone said something, the corroboration failed.
    expect(run(read(rep(12, 1.4, "automotive")))[0].mode).toBe("unknown");
  });

  it("a manual mode still wins over the speed fallback", () => {
    const legs = deriveLegs(read(rep(12, 1.4)), {
      windows: [],
      overrides: [{ fromMs: T0, untilMs: T0 + 12 * MIN, mode: "cycle", updatedAtMs: 1 }],
      stays: [],
    }).legs;
    expect(legs[0]).toMatchObject({ mode: "cycle", modeSource: "manual", confidence: "high" });
  });
});

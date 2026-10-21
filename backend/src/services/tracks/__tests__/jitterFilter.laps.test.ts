import { ingestTrack } from "../../tour/tracks/ingestTrack";
import type { ParsedTrack } from "../../tour/tracks/parseGpx";
import { filterJitter, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES, type JitterMode } from "../jitterProfiles";
import { filterParsedTrack } from "../recordingJitter";
import { BASE, T0, last, noise, offset, standing, type SyntheticFix } from "./jitterFixtures";

/**
 * Final review of forgejo#319: the stay test compares the centres of a
 * window's two halves, and a lap that comes round within half a window puts
 * both centres on the middle of the circle. Ten minutes of riding a 50 m
 * circle — a velodrome, a running track, a kart circuit — collapsed into one
 * point and measured 0 km.
 */

function laps(opts: {
  radiusM: number;
  kmh: number;
  seconds: number;
  stepS: number;
  accuracy: number | null;
}): SyntheticFix[] {
  const circumference = 2 * Math.PI * opts.radiusM;
  const radPerS = (opts.kmh / 3.6 / circumference) * 2 * Math.PI;
  return Array.from({ length: Math.floor(opts.seconds / opts.stepS) + 1 }, (_, i) => {
    const angle = radPerS * i * opts.stepS;
    const p = offset(BASE, Math.sin(angle) * opts.radiusM, Math.cos(angle) * opts.radiusM);
    return { t: T0 + i * opts.stepS * 1000, ...p, accuracy: opts.accuracy };
  });
}

const asFixes = (fixes: readonly SyntheticFix[]): JitterFix[] =>
  fixes.map((f) => ({ lon: f.lon, lat: f.lat, t: f.t, accuracyM: f.accuracy }));

function parsed(fixes: readonly SyntheticFix[]): ParsedTrack {
  return {
    points: fixes.map((f): [number, number] => [f.lon, f.lat]),
    segmentStarts: [0],
    startedAt: new Date(fixes[0].t),
    endedAt: new Date(last(fixes).t),
    name: null,
    times: fixes.map((f) => f.t),
    accuracies: fixes.map((f) => f.accuracy),
  };
}

describe("laps are movement, however often they come round", () => {
  const cases: Array<[string, JitterMode, SyntheticFix[]]> = [
    [
      "a 50 m circle at 18.85 km/h, one lap a minute",
      "bike",
      laps({ radiusM: 50, kmh: 18.85, seconds: 600, stepS: 1, accuracy: 5 }),
    ],
    [
      "a 200 m indoor running track at 12 km/h",
      "foot",
      laps({ radiusM: 32, kmh: 12, seconds: 900, stepS: 1, accuracy: 8 }),
    ],
    [
      "a 250 m velodrome at 40 km/h",
      "bike",
      laps({ radiusM: 40, kmh: 40, seconds: 600, stepS: 1, accuracy: null }),
    ],
    [
      "a 1 km kart circuit at 60 km/h, a fix every five seconds",
      "road",
      laps({ radiusM: 160, kmh: 60, seconds: 1200, stepS: 5, accuracy: 10 }),
    ],
  ];

  it.each(cases)("%s: kept, distance unchanged", (_label, mode, fixes) => {
    const result = filterJitter(asFixes(fixes), [0], JITTER_PROFILES[mode]);
    expect(result.dropped).toBeLessThan(fixes.length * 0.02);
    const raw = ingestTrack(parsed(fixes))!.distanceKm;
    const filtered = ingestTrack(filterParsedTrack(parsed(fixes), mode))!.distanceKm;
    expect(Math.abs(filtered - raw) / raw).toBeLessThan(0.02);
  });

  it("still folds a phone whose position wanders smoothly around the gate", () => {
    // A fused location drifts rather than jumps: a mean-reverting wander with
    // momentum, ~1 m/s, never more than ~100 m from where the phone lies.
    const rnd = noise(5);
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    const fixes: JitterFix[] = Array.from({ length: 1200 }, (_, i) => {
      vx = 0.9 * vx - 0.01 * x + rnd() * 0.6;
      vy = 0.9 * vy - 0.01 * y + rnd() * 0.6;
      x += vx;
      y += vy;
      return { ...offset(BASE, x, y), t: T0 + i * 1000, accuracyM: 20 };
    });
    const result = filterJitter(fixes, [0], JITTER_PROFILES.flight);
    expect(result.fixes.length).toBeLessThanOrEqual(4);
  });

  it("still folds a phone standing at the gate, sampled every second", () => {
    const gate = standing(BASE, T0, 20, 1, 80, 30);
    const result = filterJitter(asFixes(gate), [0], JITTER_PROFILES.flight);
    expect(result.fixes).toHaveLength(2);
  });
});

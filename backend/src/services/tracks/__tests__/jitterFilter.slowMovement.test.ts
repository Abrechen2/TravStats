import { ingestTrack } from "../../tour/tracks/ingestTrack";
import type { ParsedTrack } from "../../tour/tracks/parseGpx";
import { filterJitter, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES, type JitterMode } from "../jitterProfiles";
import { filterParsedTrack } from "../recordingJitter";
import { BASE, T0, last, moving, standing, type SyntheticFix } from "./jitterFixtures";

/**
 * Review finding 1 (forgejo#319): the stay test's radius grew with the
 * reported accuracy and a stay had no bound on how far it drifted, so slow
 * real movement with a poor accuracy collapsed to one point — and a fully
 * collapsed upload then failed the two-point minimum.
 */

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

describe("slow movement with a poor accuracy is never a stay", () => {
  const cases: Array<[string, JitterMode, SyntheticFix[]]> = [
    ["a walk at 4 km/h reported at 100 m", "foot", moving(BASE, T0, 30, 4, 600, 5, 100)],
    ["a plane taxiing at 3 km/h with no accuracy", "flight", moving(BASE, T0, 30, 3, 600, 5)],
    ["a ship at 5 km/h reported at 200 m", "ship", moving(BASE, T0, 30, 5, 600, 5, 200)],
  ];

  it.each(cases)("%s: kept fix by fix, distance unchanged", (_label, mode, fixes) => {
    const result = filterJitter(asFixes(fixes), [0], JITTER_PROFILES[mode]);
    expect(result.dropped).toBe(0);
    const raw = ingestTrack(parsed(fixes))!.distanceKm;
    const filtered = ingestTrack(filterParsedTrack(parsed(fixes), mode))!.distanceKm;
    expect(Math.abs(filtered - raw) / raw).toBeLessThan(0.01);
  });
});

describe("a recording that only ever stood still", () => {
  it("still makes a line of two points, its first and last moment", () => {
    const gate = standing(BASE, T0, 40, 10, 120);
    const filtered = filterParsedTrack(parsed(gate), "flight");
    expect(filtered.points).toHaveLength(2);
    expect(filtered.times).toEqual([T0, last(gate).t]);
    expect(ingestTrack(filtered)).not.toBeNull();
  });
});

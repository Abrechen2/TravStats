import { ingestTrack } from "../ingestTrack";
import type { ParsedTrack } from "../parseGpx";

/**
 * A hike up and down a straight valley: 201 points, 1 per 30 s, climbing
 * 300 m in 12 m steps... then down again. The line is perfectly straight in
 * plan view, so simplification keeps only the two ends — which is exactly why
 * the climb has to be measured before it.
 */
function valleyHike(): ParsedTrack {
  const points: Array<[number, number]> = [];
  const elevations: Array<number | null> = [];
  const times: Array<number | null> = [];
  const start = Date.parse("2026-07-15T08:00:00Z");
  for (let i = 0; i <= 200; i++) {
    points.push([6.19, 58.98 + i * 0.0003]);
    elevations.push(i <= 100 ? 300 + i * 3 : 600 - (i - 100) * 3);
    times.push(start + i * 30_000);
  }
  return {
    points,
    segmentStarts: [0],
    startedAt: new Date(start),
    endedAt: new Date(start + 200 * 30_000),
    name: "Preikestolen",
    elevations,
    times,
  };
}

describe("ingestTrack — elevation and moving time", () => {
  it("measures the climb on the raw points, not on the simplified line", () => {
    const track = ingestTrack(valleyHike())!;
    expect(track.geometry.length).toBeLessThan(10);
    expect(track.ascentM).toBe(300);
    expect(track.descentM).toBe(300);
  });

  it("keeps the summit on the profile although the line simplifies it away", () => {
    // The browser showed this on 2026-09-24: a straight path to a summit
    // simplified to its two ends, and a profile read off the simplified line
    // drew a 300 m climb as a flat line.
    const track = ingestTrack(valleyHike())!;
    const heights = track.elevationProfile!.map(([, m]) => m);
    expect(Math.max(...heights)).toBe(600);
    expect(heights[0]).toBe(300);
    expect(heights[heights.length - 1]).toBe(300);
    const kms = track.elevationProfile!.map(([km]) => km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });

  it("counts the whole walk as moving (33 m per 30 s)", () => {
    expect(ingestTrack(valleyHike())!.movingSeconds).toBe(200 * 30);
  });

  it("abstains on every figure when the source carries no elevation or times", () => {
    const { elevations: _e, times: _t, ...bare } = valleyHike();
    const track = ingestTrack(bare)!;
    expect(track.elevationProfile).toBeNull();
    expect(track.ascentM).toBeNull();
    expect(track.descentM).toBeNull();
    expect(track.movingSeconds).toBeNull();
  });
});

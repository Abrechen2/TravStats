import { splitAtGaps, withoutJitter, type StoredPoint } from "../../tripRecording/segments";
import { filterJitter } from "../jitterFilter";
import { JITTER_PROFILES } from "../jitterProfiles";
import { BASE, T0, last, moving, standing } from "./jitterFixtures";

/**
 * Review finding 2 (forgejo#319): a stay kept only the moment it began, so
 * after a long stop the next fix sat hours after the stay's only point and the
 * trip recording's gap rule (> 2 h) cut the line where the phone had recorded
 * all along.
 */

describe("a stay keeps both its arrival and its departure", () => {
  const cafe = standing(BASE, T0, 180, 300, 30, 25);
  const walk = moving(BASE, last(cafe).t, 90, 4.5, 1800, 300, 10);
  const fixes = [...cafe, ...walk];

  it("stands for the stay with two fixes at one place, first and last moment", () => {
    const result = filterJitter(
      fixes.map((f) => ({ lon: f.lon, lat: f.lat, t: f.t, accuracyM: f.accuracy })),
      [0],
      JITTER_PROFILES.mixed
    );
    const [arrive, leave] = result.fixes;
    expect(arrive.t).toBe(T0);
    expect(leave.t).toBe(last(cafe).t);
    expect([leave.lon, leave.lat]).toEqual([arrive.lon, arrive.lat]);
  });

  it("does not cut the trip recording's line after a three-hour stop", () => {
    const points: StoredPoint[] = fixes.map((f) => [f.t, f.lat, f.lon, f.accuracy]);
    expect(splitAtGaps(points)).toHaveLength(1);
    const clean = withoutJitter([{ deviceId: null, points }]);
    expect(clean.segments).toHaveLength(1);
  });
});

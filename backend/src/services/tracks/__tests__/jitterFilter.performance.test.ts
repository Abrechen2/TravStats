import { filterJitter, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES } from "../jitterProfiles";
import { BASE, T0, noise, offset } from "./jitterFixtures";

/**
 * Review finding 6 (forgejo#319): the coarse-fix pass walked outward from
 * every coarse fix while the neighbours were "close in time", so a recording
 * whose fixes share timestamps (a logger writing whole seconds, or an export
 * that stamps a batch) cost n² — 624 ms at 10 000 fixes, minutes at 100 000.
 */

function coarseCloud(count: number, sameTime: boolean): JitterFix[] {
  const rnd = noise(17);
  return Array.from({ length: count }, (_, i) => ({
    ...offset(BASE, rnd() * 2000, rnd() * 2000),
    t: sameTime ? T0 : T0 + Math.floor(i / 50) * 1000,
    accuracyM: 1500,
  }));
}

function timed(fixes: JitterFix[]): number {
  const started = performance.now();
  filterJitter(fixes, [0], JITTER_PROFILES.road);
  return performance.now() - started;
}

describe("the filter's cost stays near-linear", () => {
  it.each([
    ["every fix at one timestamp", true],
    ["fifty fixes per second", false],
  ])(
    "100 000 coarse fixes, %s: ten times the fixes, not a hundred times the time",
    (_label, same) => {
      const small = coarseCloud(10_000, same as boolean);
      const large = coarseCloud(100_000, same as boolean);
      timed(small); // warm up the JIT, so the ratio compares like with like
      const ratio = timed(large) / Math.max(timed(small), 1);
      // Linear is ~10, n log n a little more; the n² this guards against was ~100.
      expect(ratio).toBeLessThan(30);
      // And an absolute ceiling, loose enough for a slow CI runner.
      expect(timed(large)).toBeLessThan(5000);
    }
  );
});

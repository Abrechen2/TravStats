import { filterJitter, filterJitterYielding, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES } from "../jitterProfiles";
import { BASE, T0, last, moving, standing, type SyntheticFix } from "./jitterFixtures";

/**
 * The trip recording's map reruns the filter on every read over the whole
 * recording, which has no upper size (forgejo#319). Run straight through, a
 * few hundred thousand fixes held the event loop for the whole filter —
 * every other request waited. The yielding run must hand the loop back every
 * few milliseconds and still answer exactly what the straight run answers.
 */

/** Twenty minutes standing, two minutes driving, again and again; a coarse fix now and then. */
function longRecording(count: number): JitterFix[] {
  const out: SyntheticFix[] = [];
  let at = BASE;
  let t = T0;
  while (out.length < count) {
    out.push(...standing(at, t, 20, 10, 25, 15, out.length));
    t = last(out).t + 10_000;
    const drive = moving(at, t, out.length % 360, 30, 120, 10, 15);
    out.push(...drive);
    at = last(drive);
    t = last(out).t + 10_000;
  }
  return out.slice(0, count).map((f, i) => ({
    lon: f.lon,
    lat: f.lat,
    t: f.t,
    accuracyM: i % 97 === 0 ? 1500 : f.accuracy,
  }));
}

/** The longest the event loop went without running a queued callback while `work` ran. */
async function longestStall<T>(work: () => Promise<T>): Promise<{ result: T; stallMs: number }> {
  let stallMs = 0;
  let previous = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    stallMs = Math.max(stallMs, now - previous);
    previous = now;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  const result = await work();
  running = false;
  // The stretch since the last tick counts too: a run that never yields
  // finishes before the first tick and would otherwise report no stall at all.
  return { result, stallMs: Math.max(stallMs, performance.now() - previous) };
}

describe("the filter does not hold the event loop for a long recording", () => {
  const fixes = longRecording(300_000);
  const starts = [0, 150_000];

  it("hands the loop back every few milliseconds, with the straight run's exact answer", async () => {
    const straight = filterJitter(fixes, starts, JITTER_PROFILES.mixed);
    const { result, stallMs } = await longestStall(() =>
      filterJitterYielding(fixes, starts, JITTER_PROFILES.mixed)
    );
    expect(result).toEqual(straight);
    expect(result.dropped).toBeGreaterThan(0);
    // Slices are 10 ms; 100 leaves room for a slow runner's garbage collection.
    expect(stallMs).toBeLessThan(100);
  }, 120_000);

  it("does not stall on one very long stay either", async () => {
    // Eleven days at one place, a fix a second: every step that works on a
    // whole stay at once (a median over its accuracies or its centres) must
    // stay inside a slice too (final review of forgejo#319).
    const still: JitterFix[] = Array.from({ length: 1_000_000 }, (_, i) => ({
      ...BASE,
      t: T0 + i * 1000,
      accuracyM: 5 + ((i * 7919) % 290),
    }));
    const { result, stallMs } = await longestStall(() =>
      filterJitterYielding(still, [0], JITTER_PROFILES.mixed)
    );
    expect(result.fixes).toHaveLength(2);
    expect(stallMs).toBeLessThan(100);
  }, 120_000);
});

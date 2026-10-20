import { filterJitter, type JitterFix } from "../jitterFilter";
import { JITTER_PROFILES } from "../jitterProfiles";
import { BASE, T0, moving, offset, type SyntheticFix } from "./jitterFixtures";

/**
 * Review finding 3 (forgejo#319): any exact repeat of an earlier position
 * after moving away was dropped as a frozen fix, whatever the time — a walk
 * that retraces its own rounded points, or a cable car back at its terminal,
 * lost its return.
 */

const asFixes = (fixes: readonly SyntheticFix[]): JitterFix[] =>
  fixes.map((f) => ({ lon: f.lon, lat: f.lat, t: f.t, accuracyM: f.accuracy }));

/** Five-decimal coordinates, as many GPX writers round them. */
const rounded = (f: SyntheticFix): SyntheticFix => ({
  ...f,
  lat: Number(f.lat.toFixed(5)),
  lon: Number(f.lon.toFixed(5)),
});

describe("a repeated position is frozen only when it is impossible", () => {
  it("keeps a ride that retraces its own rounded points", () => {
    const out = moving(BASE, T0, 90, 20, 30, 5).map(rounded);
    const back = [...out]
      .reverse()
      .slice(1)
      .map((f, i) => ({ ...f, t: out[out.length - 1].t + (i + 1) * 5_000 }));
    const fixes = [rounded({ t: T0, ...BASE, accuracy: null }), ...out, ...back];
    expect(filterJitter(asFixes(fixes), [0], JITTER_PROFILES.bike).dropped).toBe(0);
  });

  it("keeps a cable car arriving back at its terminal's exact coordinate", () => {
    const terminal = { t: T0, ...BASE, accuracy: null };
    const up = moving(BASE, T0, 0, 18, 120, 15);
    const top = up[up.length - 1];
    const down = moving(top, top.t, 180, 18, 105, 15);
    const home = { ...terminal, t: down[down.length - 1].t + 15_000 };
    const fixes = [terminal, ...up, ...down, home];
    const result = filterJitter(asFixes(fixes), [0], JITTER_PROFILES.mixed);
    expect(result.fixes[result.fixes.length - 1]).toMatchObject({ lat: BASE.lat, lon: BASE.lon });
    expect(result.dropped).toBe(0);
  });

  it("still drops a stale cached fix that would mean an impossible jump back and forth", () => {
    const drive = moving(BASE, T0, 0, 90, 300, 5);
    const stale = [...drive];
    stale[40] = { ...stale[40], lat: stale[20].lat, lon: stale[20].lon };
    // Sanity: the stale fix lies 2.5 km behind, five seconds after the last one.
    expect(Math.abs(stale[40].lat - offset(BASE, 0, 0).lat)).toBeGreaterThan(0);
    expect(filterJitter(asFixes(stale), [0], JITTER_PROFILES.road).dropped).toBe(1);
  });
});

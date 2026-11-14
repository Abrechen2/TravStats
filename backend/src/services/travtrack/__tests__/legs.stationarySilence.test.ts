import type { StoredPoint } from "../../tripRecording/segments";
import { deriveLegs } from "../legs/derive";
import { stationarySilence, targetOf, type FoldPlace } from "../legs/fold";
import type { SafePointRow, SafeSpan } from "../readSafe";

/**
 * A phone at rest sends nothing. A silence between two fixes at the same spot is a stay
 * (one shared rule: `stationarySilence`); anything outside it stays a gap. Synthetic spot.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const M = 111_195;
const SPOT = { lat: 47.5, lon: 11.0 };
const T0 = Date.parse("2026-11-10T18:00:00Z");

type Fix = [t: number, northM: number, acc: number | null];

function read(stretches: Fix[][]): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segments = stretches.map((fixes, s) =>
    fixes.map(([t, dN, acc], i): StoredPoint => {
      const p: StoredPoint = [t, SPOT.lat + dN / M, SPOT.lon, acc];
      rows.set(p, {
        id: `p${s}-${i}`,
        t: new Date(t),
        deviceId: "d",
        accuracyM: acc,
      } as SafePointRow);
      return p;
    })
  );
  return {
    segments,
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as unknown as SafeSpan;
}

const home: FoldPlace = {
  id: "home",
  name: "Home",
  kind: "home",
  ...SPOT,
  radiusM: 150,
  window: null,
  zone: "Europe/Berlin",
};
const inputs = (extra: object = {}) => ({
  windows: [],
  overrides: [],
  stays: [],
  fold: { places: [home], lodgings: [] },
  ...extra,
});
/** An arrival: five fixes in the first minute inside Home, then nothing. */
const burst = (acc = 5): Fix[] => [0, 15, 30, 45, 60].map((s, i) => [T0 + s * 1000, 10 + i, acc]);

describe("a silence at the same spot is a stay", () => {
  it("an arrival burst, 100 min of silence and a fix 180 m out (inside Home's band) is ONE Home stop (was: no stop, a 170 m leg)", () => {
    const { stops, legs } = deriveLegs(read([[...burst(), [T0 + 100 * MIN, 180, 5]]]), inputs());
    expect(stops).toHaveLength(1);
    expect(stops[0].place?.name).toBe("Home");
    expect(stops[0].untilMs).toBe(T0 + 100 * MIN);
    expect(legs).toEqual([]);
  });

  it("the same across a track-gap cut: arrival burst, 14 h of silence, morning fix 230 m out (inside the band) is ONE Home stop", () => {
    const { stops } = deriveLegs(read([burst(), [[T0 + 14 * HOUR, 230, 5]]]), inputs());
    expect(stops).toHaveLength(1);
    expect(stops[0].place?.source).toBe("fixed");
    expect(stops[0].untilMs).toBe(T0 + 14 * HOUR);
  });

  it("478 m from Home at 3 m accuracy is a departure, not noise: the silence stays a gap", () => {
    const { stops } = deriveLegs(read([burst(3), [[T0 + 14 * HOUR, 478, 3]]]), inputs());
    expect(stops).toEqual([]);
    const sub = deriveLegs(read([[...burst(3), [T0 + 100 * MIN, 478, 3]]]), inputs());
    expect(sub.stops).toEqual([]);
  });

  it("a poor fix cannot bridge a silence", () => {
    const { stops } = deriveLegs(read([burst(), [[T0 + 14 * HOUR, 230, 80]]]), inputs());
    expect(stops).toEqual([]);
  });

  it("an unknown accuracy cannot bridge a silence", () => {
    const { stops } = deriveLegs(read([burst(), [[T0 + 14 * HOUR, 230, null]]]), inputs());
    expect(stops).toEqual([]);
  });

  it("a silence of more than 24 h stays a gap (was: unbounded)", () => {
    const { stops } = deriveLegs(read([burst(), [[T0 + 30 * HOUR, 230, 5]]]), inputs());
    expect(stops).toEqual([]);
  });

  it("without a fixed place, 65 m at 3 m accuracy is still a gap; 75 m at 40 m accuracy bridges", () => {
    const plain = { fold: undefined };
    const away = (acc: number, dN: number) =>
      deriveLegs(
        read([
          [
            [T0, 0, acc],
            [T0 + 30 * 1000, 2, acc],
            [T0 + 100 * MIN, dN, acc],
          ],
        ]),
        inputs(plain)
      );
    expect(away(3, 65).stops).toEqual([]);
    expect(away(40, 75).stops).toHaveLength(1);
  });

  it("the arrival is named Home at once on the current day, from the last fixes (was: no stop)", () => {
    const { stops } = deriveLegs(read([burst()]), inputs({ current: true }));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ place: { name: "Home" }, openEnd: true });
    // A day that is over has no such word.
    expect(deriveLegs(read([burst()]), inputs()).stops).toEqual([]);
  });

  it("the eligibility rule: separation, accuracy, length and place each decide", () => {
    const fix = (t: number, dN: number, acc: number | null): StoredPoint => [
      t,
      SPOT.lat + dN / M,
      SPOT.lon,
      acc,
    ];
    expect(stationarySilence(fix(0, 0, 5), fix(30 * MIN, 40, 5), [])).toBe(true);
    expect(stationarySilence(fix(0, 0, 5), fix(30 * MIN, 70, 5), [])).toBe(false);
    expect(stationarySilence(fix(0, 0, 5), fix(30 * MIN, 70, 5), [home])).toBe(true);
    expect(stationarySilence(fix(0, 0, 5), fix(5 * MIN, 10, 5), [])).toBe(false);
    expect(stationarySilence(fix(0, 0, 60), fix(30 * MIN, 10, 5), [])).toBe(false);
    expect(stationarySilence(fix(0, 0, 5), fix(25 * HOUR, 10, 5), [])).toBe(false);
  });
});

describe("overlapping places", () => {
  const near = (id: string, radiusM: number, dN = 0): FoldPlace => ({
    ...home,
    id,
    name: id,
    kind: "custom",
    lat: SPOT.lat + dN / M,
    radiusM,
  });
  const at: StoredPoint = [T0, SPOT.lat, SPOT.lon, 5];
  const pick = (places: FoldPlace[]) => {
    const t = targetOf(at, { places, lodgings: [] });
    return t?.source === "fixed" ? t.place.id : null;
  };

  it("the smaller radius wins, then the nearer centre, then the stable id (was: list order)", () => {
    expect(pick([near("a", 150), near("b", 100)])).toBe("b");
    expect(pick([near("a", 100, 40), near("b", 100, 10)])).toBe("b");
    expect(pick([near("z", 100, 10), near("m", 100, 10)])).toBe("m");
  });
});

describe("silences do not walk a stay away", () => {
  it("fixes 90 m apart every 30 min, 50 m accuracy, are not one stay (was: unbounded drift)", () => {
    const fixes: Fix[] = Array.from({ length: 12 }, (_, i) => [T0 + i * 30 * MIN, i * 90, 40]);
    const { stops } = deriveLegs(read([fixes]), { windows: [], overrides: [], stays: [] });
    expect(stops).toEqual([]);
  });

  it("a stay that has lasted past STOP_MS still carries openEnd on the current day", () => {
    const fixes: Fix[] = [0, 5, 10, 20, 30].map((m) => [T0 + m * MIN, 10, 5]);
    const { stops } = deriveLegs(read([fixes]), inputs({ current: true }));
    expect(stops[0]).toMatchObject({ place: { name: "Home" }, openEnd: true });
  });
});

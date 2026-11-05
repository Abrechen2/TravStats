import type { StoredPoint } from "../../tripRecording/segments";
import type { FoldPlace } from "../legs/fold";
import { deriveLegs } from "../legs/derive";
import type { SafePointRow, SafeSpan } from "../readSafe";

const MIN = 60_000;
const SPOT = { lat: 47.82673, lon: 12.19074 };
const M = 111_195;
const DAY = Date.parse("2026-11-04T23:00:00Z");

function span(fixes: Array<[number, number, number | null]>): SafeSpan {
  const rows = new WeakMap<StoredPoint, SafePointRow>();
  const segment = fixes.map(([t, dN, acc], i): StoredPoint => {
    const p: StoredPoint = [t, SPOT.lat + dN / M, SPOT.lon, acc];
    rows.set(p, {
      id: `p${i}`,
      t: new Date(t),
      lat: p[1],
      lon: p[2],
      accuracyM: acc,
      deviceId: "d",
    } as SafePointRow);
    return p;
  });
  return {
    segments: [segment],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [],
    paused: [],
    next: null,
    cursor: null,
  } as unknown as SafeSpan;
}

const still = (everyMin: number, acc: number | null = 8) => {
  const out: Array<[number, number, number | null]> = [];
  for (let t = DAY, i = 0; t <= DAY + 24 * 60 * MIN; t += everyMin * MIN, i++)
    out.push([t, (i % 2 ? 1 : -1) * 15, acc]);
  return out;
};

const custom: FoldPlace = {
  id: "c1",
  name: "Cabin",
  kind: "custom",
  ...SPOT,
  radiusM: 150,
  window: null,
  zone: "Europe/Berlin",
};

describe("travtrack: a day spent in one spot", () => {
  it.each([5, 30, 100])("shows one stop for a whole still day (fix every %i min)", (every) => {
    const { stops, legs } = deriveLegs(span(still(every)), {
      windows: [],
      overrides: [],
      stays: [],
    });
    expect(legs).toEqual([]);
    expect(stops).toHaveLength(1);
  });

  it("folds a whole still day into the fixed place", () => {
    const { stops } = deriveLegs(span(still(5)), {
      windows: [],
      overrides: [],
      stays: [],
      fold: { places: [custom], lodgings: [] },
    });
    expect(stops).toHaveLength(1);
    expect(stops[0].place?.source).toBe("fixed");
    expect(stops[0].folded).not.toBeNull();
  });

  it("a still day recorded as lone fixes across 2 h+ silences still has its stop (was: stops [])", () => {
    const fixes = still(180); // every 3 h: every fix is its own stretch
    const read = span(fixes);
    read.segments = fixes.map((_, i) => [read.segments[0][i]]);
    const { stops } = deriveLegs(read, { windows: [], overrides: [], stays: [] });
    expect(stops).toHaveLength(1);
    expect(stops[0].fromMs).toBe(DAY);
  });

  it("folds that sparse day into the fixed place", () => {
    const fixes = still(180);
    const read = span(fixes);
    read.segments = fixes.map((_, i) => [read.segments[0][i]]);
    const { stops } = deriveLegs(read, {
      windows: [],
      overrides: [],
      stays: [],
      fold: { places: [custom], lodgings: [] },
    });
    expect(stops).toHaveLength(1);
    expect(stops[0].place?.source).toBe("fixed");
  });

  it("does not bridge a silence the phone announced as paused", () => {
    const fixes = still(180);
    const read = span(fixes);
    read.segments = fixes.map((_, i) => [read.segments[0][i]]);
    read.paused = [
      { fromMs: DAY + 3 * 60 * MIN, untilMs: DAY + 5 * 60 * MIN, deviceId: "d", reason: "x" },
    ];
    const { stops } = deriveLegs(read, { windows: [], overrides: [], stays: [] });
    expect(
      stops.every((s) => s.fromMs >= DAY + 5 * 60 * MIN || s.untilMs <= DAY + 3 * 60 * MIN)
    ).toBe(true);
  });

  it("does not bridge a silence beside a privacy zone (the visit inside it is hidden)", () => {
    const fixes = still(180);
    const read = span(fixes);
    read.segments = fixes.map((_, i) => [read.segments[0][i]]);
    read.circles = [{ lat: SPOT.lat + 200 / M, lon: SPOT.lon, radiusM: 50 }];
    const { stops } = deriveLegs(read, { windows: [], overrides: [], stays: [] });
    expect(stops).toEqual([]);
  });

  it("a zone visited mid-day (fixes cut out, far from the spot) is never joined over: two stops", () => {
    const morning = still(30).filter(([t]) => t < DAY + 6 * 60 * MIN);
    const evening = still(30).filter(([t]) => t > DAY + 12 * 60 * MIN);
    const fixes = [...morning, ...evening];
    const read = span(fixes);
    const pts = read.segments[0];
    read.segments = [
      pts.filter((p) => p[0] < DAY + 6 * 60 * MIN),
      pts.filter((p) => p[0] > DAY + 12 * 60 * MIN),
    ];
    read.circles = [{ lat: SPOT.lat + 3000 / M, lon: SPOT.lon, radiusM: 100 }];
    read.cutAtMs = [DAY + 8 * 60 * MIN, DAY + 9 * 60 * MIN];
    const { stops } = deriveLegs(read, { windows: [], overrides: [], stays: [] });
    expect(stops).toHaveLength(2);
    expect(stops[0].untilMs).toBeLessThan(DAY + 8 * 60 * MIN);
    expect(stops[1].fromMs).toBeGreaterThan(DAY + 9 * 60 * MIN);
  });
});

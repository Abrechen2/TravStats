import { detectClockOffset } from "../clockOffset";
import { resolveDay, keepsRow } from "../resolveDay";
import { rankSources, scoreOf, sourceSignals } from "../score";
import type { SourcePoint, TravelEntry } from "../types";

const H = 3_600_000;
const MIN = 60_000;
const DAY = {
  fromMs: Date.parse("2026-08-10T00:00:00Z"),
  untilMs: Date.parse("2026-08-11T00:00:00Z"),
};
const PHONE = "companion:phone-1";
const GOOGLE = "gpx:takeout";

let seq = 0;
/** Points every `stepMin` minutes from `fromH` to `untilH`, walking east from Munich. */
function track(
  origin: string,
  fromH: number,
  untilH: number,
  stepMin: number,
  extra: Partial<SourcePoint> & { dLat?: number } = {}
): SourcePoint[] {
  const out: SourcePoint[] = [];
  for (let t = DAY.fromMs + fromH * H; t < DAY.fromMs + untilH * H; t += stepMin * MIN) {
    const f = (t - DAY.fromMs) / (24 * H);
    out.push({
      id: `${origin}-${seq++}`,
      tMs: t,
      lat: 48.137 + (extra.dLat ?? 0),
      lon: 11.575 + f * 0.5,
      accuracyM: extra.accuracyM === undefined ? 8 : extra.accuracyM,
      origin,
    });
  }
  return out;
}

const byTime = (pts: SourcePoint[]) => [...pts].sort((a, b) => a.tMs - b.tMs);

describe("best source per day", () => {
  it("a mixed day picks the phone source over a sparse Google import (was: both drawn, zigzag)", () => {
    const phone = track(PHONE, 0, 24, 1);
    // Google: every 20 minutes with gaps, no accuracy, offset a little: the zigzag.
    const google = track(GOOGLE, 0, 24, 20, { accuracyM: null, dLat: 0.01 }).filter(
      (_, i) => i % 5 !== 0
    );
    const r = resolveDay({
      window: DAY,
      points: byTime([...phone, ...google]),
      entries: [],
      override: null,
    });
    expect(r.scores[0].source).toBe(PHONE);
    expect(r.segments).toEqual([{ ...DAY, source: PHONE }]);
    expect(r.mixed).toBe(true);
  });

  it("hands off within the day when the phone starts recording at noon", () => {
    const google = track(GOOGLE, 0, 24, 10, { accuracyM: null });
    const phone = track(PHONE, 12, 24, 1);
    const r = resolveDay({
      window: DAY,
      points: byTime([...phone, ...google]),
      entries: [],
      override: null,
    });
    expect(r.scores[0].source).toBe(PHONE);
    expect(r.segments.map((s) => s.source)).toEqual([GOOGLE, PHONE]);
    const handoff = r.segments[1].fromMs;
    expect(Math.abs(handoff - (DAY.fromMs + 12 * H))).toBeLessThanOrEqual(15 * MIN);
    expect(r.segments[0].fromMs).toBe(DAY.fromMs);
    expect(r.segments[1].untilMs).toBe(DAY.untilMs);
  });

  it("does not hand off for a short silence of the primary (minimum segment)", () => {
    const google = track(GOOGLE, 0, 24, 10, { accuracyM: null });
    const phone = [...track(PHONE, 0, 10, 1), ...track(PHONE, 10.5, 24, 1)];
    const r = resolveDay({
      window: DAY,
      points: byTime([...phone, ...google]),
      entries: [],
      override: null,
    });
    expect(r.segments).toEqual([{ ...DAY, source: PHONE }]);
  });

  it("counts a missing accuracy as unknown: between a precise and a 2000 m source", () => {
    const base = track("x", 0, 24, 5);
    const as = (accuracyM: number | null) => base.map((p) => ({ ...p, accuracyM }));
    const score = (pts: SourcePoint[]) => scoreOf(sourceSignals(pts, DAY), pts);
    const precise = score(as(10));
    const unknown = score(as(null));
    const coarse = score(as(2000));
    expect(precise).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(coarse);
    // Exactly the middle: unknown is neither good nor bad.
    expect(unknown).toBeCloseTo((precise + coarse) / 2, 3);
  });

  it("draws a jump that matches a logged flight as the flight (bridge), not as an outlier", () => {
    const munich = track(PHONE, 6, 9, 2);
    const lisbon = track(PHONE, 13, 18, 2).map((p) => ({ ...p, lat: 38.72, lon: -9.14 }));
    const flight: TravelEntry = {
      kind: "flight",
      id: "f1",
      fromMs: DAY.fromMs + 10 * H,
      untilMs: DAY.fromMs + 12.5 * H,
      dep: { lat: 48.354, lon: 11.786 },
      arr: { lat: 38.774, lon: -9.134 },
    };
    const r = resolveDay({
      window: DAY,
      points: [...munich, ...lisbon],
      entries: [flight],
      override: null,
    });
    expect(r.bridges).toEqual([
      expect.objectContaining({ kind: "flight", entryId: "f1", reason: "jump" }),
    ]);
    expect(r.outlierIds).toEqual([]);
    expect(r.breaks).toEqual([]);
  });

  it("never invents a route when two different entries could explain a jump", () => {
    const a = track(PHONE, 6, 9, 2);
    const b = track(PHONE, 13, 18, 2).map((p) => ({ ...p, lat: 38.72, lon: -9.14 }));
    const one: TravelEntry = {
      kind: "flight",
      id: "f1",
      fromMs: DAY.fromMs + 10 * H,
      untilMs: DAY.fromMs + 12 * H,
      dep: { lat: 48.354, lon: 11.786 },
      arr: { lat: 38.774, lon: -9.134 },
    };
    const other = { ...one, id: "f2", arr: { lat: 38.2, lon: -8.6 } };
    const r = resolveDay({
      window: DAY,
      points: [...a, ...b],
      entries: [one, other],
      override: null,
    });
    expect(r.bridges).toEqual([]);
    expect(r.breaks).toHaveLength(1);
  });

  it("excludes an unsupported out-and-back teleport as outliers, and breaks a one-way jump", () => {
    const day = track(PHONE, 6, 18, 5);
    const k = 40;
    const teleported = day.map((p, i) =>
      i === k || i === k + 1 ? { ...p, lat: 40.4, lon: -3.7 } : p
    );
    const r = resolveDay({ window: DAY, points: teleported, entries: [], override: null });
    expect(r.outlierIds).toEqual([teleported[k].id, teleported[k + 1].id]);
    expect(r.breaks).toEqual([]);

    const oneWay = day.map((p, i) => (i >= k ? { ...p, lat: 40.4, lon: -3.7 } : p));
    const r2 = resolveDay({ window: DAY, points: oneWay, entries: [], override: null });
    expect(r2.outlierIds).toEqual([]);
    expect(r2.breaks).toEqual([[oneWay[k - 1].tMs, oneWay[k].tMs]]);
  });

  it("follows the override for the whole day", () => {
    const phone = track(PHONE, 0, 24, 1);
    const google = track(GOOGLE, 0, 24, 10, { accuracyM: null });
    const r = resolveDay({
      window: DAY,
      points: byTime([...phone, ...google]),
      entries: [],
      override: GOOGLE,
    });
    expect(r.segments).toEqual([{ ...DAY, source: GOOGLE }]);
  });

  it("keepsRow keeps unresolved days and sources the resolution has not judged yet", () => {
    const day = {
      ...DAY,
      segments: [{ ...DAY, source: PHONE }],
      override: null,
      known: new Set([PHONE, GOOGLE]),
      outlierIds: new Set(["bad"]),
      breaks: [],
      bridges: [],
    };
    const t = new Date(DAY.fromMs + H);
    expect(keepsRow([day], { id: "a", t, origin: PHONE })).toBe(true);
    expect(keepsRow([day], { id: "b", t, origin: GOOGLE })).toBe(false);
    expect(keepsRow([day], { id: "bad", t, origin: PHONE })).toBe(false);
    expect(keepsRow([day], { id: "c", t, origin: "dawarich:new" })).toBe(true);
    expect(keepsRow([], { id: "d", t, origin: GOOGLE })).toBe(true);
  });
});

describe("clock offset between sources", () => {
  it("reports a constant one-hour offset and never one between aligned sources", () => {
    // Driving east at ~30 km/h: a shifted clock puts the same instant 30 km apart.
    const phone = track(PHONE, 6, 18, 2).map((p) => ({
      ...p,
      lon: 8 + ((p.tMs - DAY.fromMs) / H) * 0.4,
    }));
    const shifted = phone.map((p) => ({ ...p, id: `g-${p.id}`, origin: GOOGLE, tMs: p.tMs + H }));
    expect(detectClockOffset(phone, shifted)).toBe(3600);
    const aligned = phone.map((p) => ({ ...p, id: `a-${p.id}`, origin: GOOGLE }));
    expect(detectClockOffset(phone, aligned)).toBeNull();
    const r = resolveDay({
      window: DAY,
      points: byTime([...phone, ...shifted]),
      entries: [],
      override: null,
    });
    expect(r.clockOffset).toEqual({
      source: expect.any(String),
      relativeTo: expect.any(String),
      offsetS: expect.any(Number),
    });
    expect(Math.abs(r.clockOffset!.offsetS)).toBe(3600);
  });

  it("says nothing on a day without movement", () => {
    const still = track(PHONE, 6, 18, 2).map((p) => ({ ...p, lon: 11.575 }));
    const shifted = still.map((p) => ({ ...p, id: `g-${p.id}`, tMs: p.tMs + H }));
    expect(detectClockOffset(still, shifted)).toBeNull();
  });
});

describe("ranking", () => {
  it("is stable for equal scores", () => {
    const a = track("b:1", 0, 2, 5);
    const b = a.map((p) => ({ ...p, origin: "a:1" }));
    const ranked = rankSources(
      new Map([
        ["b:1", a],
        ["a:1", b],
      ]),
      DAY
    );
    expect(ranked.map((r) => r.source)).toEqual(["a:1", "b:1"]);
  });
});

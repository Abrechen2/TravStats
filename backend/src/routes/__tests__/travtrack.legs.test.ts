import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { removeAccount } from "../../services/account/removeAccount";
import { buildTravTrackDataExport } from "../../services/travtrack/accountExport";
import { travTrackRange } from "../../services/travtrack/rangeView";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { generateToken } from "../../utils/jwt";

/**
 * Legs and stops of the day view, the range aggregates and the mode
 * correction (spec 2026-11-03-travtrack-legs, S1). The fixture day, on the
 * Seoul clock: a walk, a train the logbook holds, a walk, half an hour
 * standing still, then movement nothing corroborates.
 */

const PREFIX = "travtrack-legs-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T15:00:00Z"); // 12 Oct 00:00 in Seoul
const T0 = DAY_START + 6 * 60 * MIN;
const LAT0 = 37.5;
const LON0 = 127;
const M_PER_DEG = 111_195;

type Fix = { min: number; lat: number; lon: number } & Partial<{
  speedMps: number;
  altitudeM: number;
  motion: string;
}>;

/** A walk northwards from `from`: a fix a minute at 1.4 m/s. */
function walk(startMin: number, endMin: number, from: number, altitude?: (min: number) => number) {
  const out: Fix[] = [];
  for (let m = startMin; m <= endMin; m++) {
    out.push({
      min: m,
      lat: from + ((m - startMin) * 84) / M_PER_DEG,
      lon: LON0,
      speedMps: 1.4,
      motion: "walking",
      ...(altitude ? { altitudeM: altitude(m) } : {}),
    });
  }
  return out;
}

function day(): { fixes: Fix[]; trainEndLat: number; standLat: number } {
  const w1 = walk(0, 10, LAT0, (m) => (m < 3 ? 10 : 10 + (m - 3) * 3));
  const trainStart = w1[w1.length - 1].lat;
  const train: Fix[] = [];
  for (let m = 12; m <= 30; m += 2) {
    train.push({
      min: m,
      lat: trainStart + ((m - 10) * 60 * 20) / M_PER_DEG,
      lon: LON0,
      speedMps: 20,
      motion: "automotive",
    });
  }
  const trainEndLat = train[train.length - 1].lat;
  const w2 = walk(31, 40, trainEndLat + 84 / M_PER_DEG);
  const standLat = w2[w2.length - 1].lat;
  const stand: Fix[] = [];
  for (let m = 45; m <= 70; m += 5) {
    stand.push({ min: m, lat: standLat, lon: LON0 + (m % 10) * 0.00001, motion: "stationary" });
  }
  const unknown: Fix[] = [];
  for (let m = 71; m <= 80; m++) {
    // The phone says walking at 3.5 m/s: motion that speed does not corroborate. Without any
    // motion the speed fallback would read this pace as cycling (low confidence).
    unknown.push({
      min: m,
      lat: standLat + ((m - 70) * 210) / M_PER_DEG,
      lon: LON0,
      motion: "walking",
    });
  }
  return { fixes: [...w1, ...train, ...w2, ...stand, ...unknown], trainEndLat, standLat };
}

describe("TravTrack — legs, stops and the mode correction", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const getDay = () =>
    request(app).get("/api/v1/travtrack/day").query({ date: "2026-10-12" }).set("Cookie", cookie);
  const putMode = (body: unknown) =>
    request(app)
      .put("/api/v1/travtrack/legs/mode")
      .set("Cookie", cookie)
      .send(body as object);

  const store = async (fixes: Fix[], id = userId) => {
    for (const f of fixes) await storePoint(id, { ...f, t: T0 + f.min * MIN });
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } } },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  async function trainEntry(): Promise<string> {
    const rail = await prisma.railJourney.create({
      data: {
        userId,
        depStationName: "A",
        depLat: LAT0,
        depLon: LON0,
        arrStationName: "B",
        arrLat: LAT0 + 0.3,
        arrLon: LON0,
        departureTime: new Date(T0 + 10 * MIN),
        arrivalTime: new Date(T0 + 30 * MIN),
      },
    });
    return rail.id;
  }

  it("cuts the fixture day into walk, train (entry), walk, a stop, and an unknown leg", async () => {
    const railId = await trainEntry();
    await store(day().fixes);
    const res = await getDay();
    expect(res.status).toBe(200);
    const { legs, stops } = res.body;
    expect(legs.map((l: { mode: string; modeSource: string }) => [l.mode, l.modeSource])).toEqual([
      ["walk", "auto"],
      ["train", "entry"],
      ["walk", "auto"],
      ["unknown", "auto"],
    ]);
    expect(legs[0]).toMatchObject({
      id: `${T0}-${T0 + 10 * MIN}`,
      confidence: "high",
      entryRef: null,
      durationMs: 10 * MIN,
      ranges: [{ segment: 0, from: 0, to: 10 }],
    });
    expect(legs[0].distanceM).toBeGreaterThan(780);
    expect(legs[0].distanceM).toBeLessThan(900);
    expect(legs[1]).toMatchObject({ confidence: "high", entryRef: { domain: "rail", id: railId } });
    expect(legs[3]).toMatchObject({ confidence: "low", entryRef: null });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      fromMs: T0 + 40 * MIN,
      untilMs: T0 + 70 * MIN,
      stayRef: null,
    });
    // Legs are ordered, and a leg's ranges index the vertices it spans.
    const seg = res.body.segments[0];
    for (const l of legs) {
      const [r] = l.ranges;
      expect(seg[r.from][0]).toBe(l.fromMs);
      expect(seg[r.to][0]).toBe(l.untilMs);
    }
  });

  it("a figure that cannot be derived is null, never 0", async () => {
    await trainEntry();
    await store(day().fixes);
    const { legs } = (await getDay()).body;
    // The walk with altitudes has a climb; the one without has none to give.
    expect(legs[0].ascentM).toBeGreaterThan(0);
    expect(legs[2].ascentM).toBeNull();
    expect(legs[2].descentM).toBeNull();
    // The unknown leg's fixes carry no speed: top speed and pace follow the fixes' deltas.
    expect(legs[3].maxSpeedMps).toBeCloseTo(3.5, 0);
    expect(legs[3].avgSpeedMps).toBeCloseTo(3.5, 0);
    expect(legs[0].maxSpeedMps).toBeCloseTo(1.4, 1);
  });

  it("a leg's moving time is null when every step spans a recording gap", async () => {
    // Two fixes half an hour apart: a leg of one step, longer than a step may span.
    await storePoint(userId, { t: T0, lat: LAT0, lon: LON0, motion: "automotive", speedMps: 15 });
    await storePoint(userId, {
      t: T0 + 30 * MIN,
      lat: LAT0 + 0.1,
      lon: LON0,
      motion: "automotive",
      speedMps: 15,
    });
    const { legs } = (await getDay()).body;
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: "unknown", movingMs: null, avgSpeedMps: null });
    expect(legs[0].distanceM).toBeGreaterThan(10_000);
  });

  it("never emits a stop inside a privacy zone, nor a leg through it", async () => {
    const { fixes, standLat } = day();
    await store(fixes);
    // The zone appears after the points were stored: they must not show.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Dort", lat: standLat, lon: LON0, radiusM: 300 },
    });
    const res = await getDay();
    expect(res.body.stops).toEqual([]);
    expect(res.body.legs.length).toBeGreaterThan(0);
    for (const l of res.body.legs) {
      for (const r of l.ranges) {
        for (const p of res.body.segments[r.segment].slice(r.from, r.to + 1)) {
          expect(Math.abs(p[1] - standLat) * M_PER_DEG).toBeGreaterThan(300);
        }
      }
    }
  });

  it("derives nothing from another account's points", async () => {
    await store(day().fixes, otherId);
    const res = await getDay();
    expect(res.body.legs).toEqual([]);
    expect(res.body.stops).toEqual([]);
  });

  it("a point's speed, altitude and motion reach the inspector", async () => {
    await storePoint(userId, {
      t: T0,
      lat: LAT0,
      lon: LON0,
      speedMps: 1.2,
      altitudeM: 42,
      motion: "walking",
    });
    await storePoint(userId, { t: T0 + MIN, lat: LAT0, lon: LON0 });
    const res = await getDay();
    expect(res.body.pointDetails).toEqual([
      [
        { speedMps: 1.2, altitudeM: 42, motion: "walking" },
        { speedMps: null, altitudeM: null, motion: null },
      ],
    ]);
  });

  describe("the mode correction", () => {
    it("applies, survives a small shift of its span, and resets", async () => {
      await store(day().fixes);
      const leg = (await getDay()).body.legs[0];
      const put = await putMode({ fromMs: leg.fromMs, untilMs: leg.untilMs, mode: "cycle" });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({
        id: leg.id,
        mode: "cycle",
        modeSource: "manual",
        confidence: "high",
        entryRef: null,
      });
      // A late point shifts the leg a little: the stored span still covers it by more than half.
      await putMode({ fromMs: leg.fromMs - 20_000, untilMs: leg.untilMs + 20_000, mode: "cycle" });
      const shown = (await getDay()).body.legs[0];
      expect(shown).toMatchObject({ mode: "cycle", modeSource: "manual" });
      const reset = await putMode({ fromMs: leg.fromMs, untilMs: leg.untilMs, mode: null });
      expect(reset.status).toBe(200);
      // The shifted row covered the leg too: a reset takes every correction that holds it.
      expect(reset.body).toMatchObject({ mode: "walk", modeSource: "auto" });
      expect(await prisma.travTrackLegMode.count({ where: { userId } })).toBe(0);
    });

    it("covers a leg only by more than half of it", async () => {
      await store(day().fixes);
      const leg = (await getDay()).body.legs[0]; // 10 minutes
      const sixth = await putMode({
        fromMs: leg.fromMs,
        untilMs: leg.fromMs + 4 * MIN,
        mode: "car",
      });
      expect(sixth.status).toBe(404);
      expect(sixth.body.code).toBe("TRAVTRACK_LEG_NOT_FOUND");
      expect(await prisma.travTrackLegMode.count({ where: { userId } })).toBe(0);
      const more = await putMode({
        fromMs: leg.fromMs,
        untilMs: leg.fromMs + 6 * MIN,
        mode: "car",
      });
      expect(more.status).toBe(200);
      expect(more.body).toMatchObject({ id: leg.id, mode: "car", modeSource: "manual" });
    });

    it("a correction beats the logbook entry", async () => {
      await trainEntry();
      await store(day().fixes);
      const train = (await getDay()).body.legs[1];
      const put = await putMode({ fromMs: train.fromMs, untilMs: train.untilMs, mode: "bus" });
      expect(put.body).toMatchObject({ mode: "bus", modeSource: "manual", entryRef: null });
    });

    it("answers TRAVTRACK_LEG_INVALID for a bad span or mode", async () => {
      for (const body of [
        { fromMs: 2000, untilMs: 1000, mode: "walk" },
        { fromMs: 1000, untilMs: 1000, mode: "walk" },
        { fromMs: 0, untilMs: 3 * 86_400_000, mode: "walk" },
        { fromMs: 1.5, untilMs: 2000, mode: "walk" },
        { fromMs: 1000, untilMs: 2000, mode: "teleport" },
        { fromMs: 1000, untilMs: 2000 },
        {},
      ]) {
        const res = await putMode(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("TRAVTRACK_LEG_INVALID");
      }
    });

    it("answers TRAVTRACK_LEG_NOT_FOUND when no leg lies under the span", async () => {
      await store(day().fixes);
      const res = await putMode({
        fromMs: T0 + 100 * MIN,
        untilMs: T0 + 110 * MIN,
        mode: "walk",
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("TRAVTRACK_LEG_NOT_FOUND");
    });

    it("is one account's own: another account's legs are not under the span", async () => {
      await store(day().fixes, otherId);
      const res = await putMode({ fromMs: T0, untilMs: T0 + 10 * MIN, mode: "walk" });
      expect(res.status).toBe(404);
    });

    it("is carried in the account export and goes with the account", async () => {
      await store(day().fixes);
      const leg = (await getDay()).body.legs[0];
      await putMode({ fromMs: leg.fromMs, untilMs: leg.untilMs, mode: "run" });
      const exported = await buildTravTrackDataExport(userId);
      expect(exported.legModes).toEqual([
        expect.objectContaining({
          fromMs: String(leg.fromMs),
          untilMs: String(leg.untilMs),
          mode: "run",
        }),
      ]);
      await removeAccount(userId);
      expect(await prisma.travTrackLegMode.count({ where: { userId } })).toBe(0);
      userId = await makeUser(`${PREFIX}a`);
      cookie = `auth_token=${generateToken(userId)}`;
    });

    it("survives a point and a range delete", async () => {
      await store(day().fixes);
      const leg = (await getDay()).body.legs[0];
      await putMode({ fromMs: leg.fromMs, untilMs: leg.untilMs, mode: "run" });
      await request(app)
        .delete("/api/v1/travtrack/points")
        .query({ from: new Date(T0).toISOString(), to: new Date(T0 + 5 * MIN).toISOString() })
        .set("Cookie", cookie)
        .expect(200);
      expect(await prisma.travTrackLegMode.count({ where: { userId } })).toBe(1);
    });
  });

  describe("range aggregates", () => {
    it("are read from the stored points, not from the simplified drawing", async () => {
      // A zig-zag that simplifies to a straight line: the drawing is shorter than the way.
      for (let i = 0; i < 40; i++) {
        await storePoint(userId, {
          t: T0 + i * MIN,
          lat: LAT0 + i * 0.0002,
          lon: LON0 + (i % 2) * 0.0004,
          speedMps: 1.5,
          motion: "walking",
        });
      }
      const window = { fromMs: DAY_START, untilMs: DAY_START + 86_400_000 };
      const full = await travTrackRange(userId, window, null);
      const squeezed = await travTrackRange(userId, window, null, { vertices: 3 });
      expect(full.simplified).toBe(false);
      expect(squeezed.simplified).toBe(true);
      expect(squeezed.pointCount).toBeLessThan(full.pointCount);
      expect(squeezed.aggregates).toEqual(full.aggregates);
      expect(full.aggregates.distanceM).toBeGreaterThan(squeezed.pointCount * 100);
      expect(full.aggregates.movingMs).toBe(39 * MIN);
      expect(full.aggregates.maxSpeedMps).toBeCloseTo(1.5, 1);
      expect(full.pointDetails[0][0]).toEqual({
        speedMps: 1.5,
        altitudeM: null,
        motion: "walking",
      });
    });

    it("say null, not 0, where nothing could be measured", async () => {
      await storePoint(userId, { t: T0, lat: LAT0, lon: LON0 });
      const window = { fromMs: DAY_START, untilMs: DAY_START + 86_400_000 };
      const range = await travTrackRange(userId, window, null);
      expect(range.aggregates).toEqual({ distanceM: 0, movingMs: null, maxSpeedMps: null });
    });
  });
});

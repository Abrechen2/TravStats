import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { buildTravTrackDataExport } from "../../services/travtrack/accountExport";
import { generateToken } from "../../utils/jwt";

/**
 * A stop dismissed as only a wait (travtrack-stop-dismiss-wait): a span-bound,
 * undoable correction. The stop stays in the day, flagged, so it can be restored;
 * points and legs never change.
 */

const PREFIX = "travtrack-stopdismissed-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T15:00:00Z"); // 12 Oct 00:00 in Seoul
const T0 = DAY_START + 2 * 60 * MIN;
const LAT0 = 37.5;
const LON0 = 127;

describe("TravTrack — dismiss a stop", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const getDay = () =>
    request(app).get("/api/v1/travtrack/day").query({ date: "2026-10-12" }).set("Cookie", cookie);
  const put = (body: object) =>
    request(app).put("/api/v1/travtrack/stops/dismissed").set("Cookie", cookie).send(body);
  const stand = async (fromMin: number, toMin: number) => {
    for (let m = fromMin; m <= toMin; m += 5) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0,
        lon: LON0,
        accuracyM: 5,
        motion: "stationary",
      });
    }
  };
  const span = { fromMs: T0, untilMs: T0 + 30 * MIN };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });
  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackStopDismissal.deleteMany({ where: { userId } });
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

  it("flags the stop in the day, leaves the points alone, and restoring takes the flag away", async () => {
    await stand(0, 30);
    const before = (await getDay()).body;
    expect(before.stops[0].dismissed).toBeUndefined();
    const points = await prisma.travTrackPoint.count({ where: { userId } });

    const res = await put({ ...span, dismissed: true });
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBe(true);
    const after = (await getDay()).body;
    expect(after.stops).toHaveLength(1);
    expect(after.stops[0].dismissed).toBe(true);
    expect(after.legs).toEqual(before.legs);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(points);

    const back = await put({ ...span, dismissed: false });
    expect(back.status).toBe(200);
    expect(back.body.dismissed).toBeUndefined();
    expect((await getDay()).body.stops[0].dismissed).toBeUndefined();
    expect(await prisma.travTrackStopDismissal.count({ where: { userId } })).toBe(0);
  });

  it("is harmless to repeat: one row, not two", async () => {
    await stand(0, 30);
    expect((await put({ ...span, dismissed: true })).status).toBe(200);
    expect((await put({ ...span, dismissed: true })).status).toBe(200);
    expect(await prisma.travTrackStopDismissal.count({ where: { userId } })).toBe(1);
  });

  it("survives a late point that lengthens the stop", async () => {
    await stand(0, 30);
    await put({ ...span, dismissed: true });
    await stand(35, 45);
    const stops = (await getDay()).body.stops;
    expect(stops).toHaveLength(1);
    expect(stops[0].untilMs).toBeGreaterThan(span.untilMs);
    expect(stops[0].dismissed).toBe(true);
  });

  it("restoring one of two stops a late gap split keeps the other one dismissed", async () => {
    // One dismissed span that, with the points as they are now, holds two stops.
    await prisma.travTrackStopDismissal.create({
      data: { userId, fromMs: BigInt(T0), untilMs: BigInt(T0 + 70 * MIN) },
    });
    await stand(0, 20);
    for (const m of [22, 24, 26, 28]) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0 + (m - 20) * 0.002,
        lon: LON0,
        accuracyM: 5,
      });
    }
    for (let m = 30; m <= 60; m += 5) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0 + 0.02,
        lon: LON0,
        accuracyM: 5,
        motion: "stationary",
      });
    }
    const stops = (await getDay()).body.stops as Array<{
      fromMs: number;
      untilMs: number;
      dismissed?: true;
    }>;
    expect(stops).toHaveLength(2);
    expect(stops.every((s) => s.dismissed === true)).toBe(true);
    const res = await put({ fromMs: stops[0].fromMs, untilMs: stops[0].untilMs, dismissed: false });
    expect(res.status).toBe(200);
    const after = (await getDay()).body.stops as Array<{ dismissed?: true }>;
    expect(after[0].dismissed).toBeUndefined();
    expect(after[1].dismissed).toBe(true);
  });

  it("is carried in the account export", async () => {
    await stand(0, 30);
    await put({ ...span, dismissed: true });
    const exported = await buildTravTrackDataExport(userId);
    expect(exported.stopDismissals).toEqual([
      expect.objectContaining({ fromMs: String(span.fromMs), untilMs: String(span.untilMs) }),
    ]);
  });

  it("404s a span under no stop and stores nothing; 400 for a bad span; 401 signed out; 403 while off", async () => {
    const none = await put({ ...span, dismissed: true });
    expect(none.status).toBe(404);
    expect(none.body.code).toBe("TRAVTRACK_STOP_NOT_FOUND");
    expect(await prisma.travTrackStopDismissal.count({ where: { userId } })).toBe(0);
    const bad = await put({ fromMs: T0, untilMs: T0, dismissed: true });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("TRAVTRACK_STOP_INVALID");
    expect((await put({ ...span })).status).toBe(400);
    expect(
      (
        await request(app)
          .put("/api/v1/travtrack/stops/dismissed")
          .send({ ...span, dismissed: true })
      ).status
    ).toBe(401);
    await switches.set({ beta: true, config: false });
    expect((await put({ ...span, dismissed: true })).status).toBe(403);
  });
});

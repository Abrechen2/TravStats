import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { utcMidnight } from "../../services/countryDays/store";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * `DELETE /travtrack/points/:id` (TravTrack plan T5.3): exactly the named
 * point goes — never another fix of its instant — with the invalidation a
 * range delete runs (E5/E6): its day's and the neighbours' country days and
 * monthly values go and the days are owed again. Another account's point is
 * 404 and stays. The day read names each vertex's point so the inspector can.
 */

const PREFIX = "travtrack-point-delete-";
const T = Date.parse("2026-10-10T12:00:00Z");
const SEOUL = { lat: 37.5665, lon: 126.978 };

describe("TravTrack — delete one point", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const del = (id: string, as = cookie) =>
    request(app).delete(`/api/v1/travtrack/points/${id}`).set("Cookie", as);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    const where = { userId: { in: [userId, otherId] } };
    await prisma.travTrackMonthValue.deleteMany({ where });
    await prisma.travTrackDirtyDay.deleteMany({ where });
    await prisma.countryDay.deleteMany({ where });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("deletes exactly that point: another fix of the same instant stays, and no span is remembered", async () => {
    const gone = await storePoint(userId, { t: T, ...SEOUL, device: "phone-1" });
    const kept = await storePoint(userId, {
      t: T,
      lat: SEOUL.lat + 0.01,
      lon: SEOUL.lon,
      device: "phone-2",
    });

    const res = await del(gone);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(await prisma.travTrackPoint.findUnique({ where: { id: gone } })).toBeNull();
    expect(await prisma.travTrackPoint.findUnique({ where: { id: kept } })).not.toBeNull();
    expect(await prisma.travTrackDeletedRange.count({ where: { userId } })).toBe(0);
  });

  it("takes its day's and the neighbours' projections with it and owes the days again", async () => {
    const id = await storePoint(userId, { t: T, ...SEOUL });
    for (const day of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-13"]) {
      await prisma.countryDay.create({
        data: {
          userId,
          source: "travtrack",
          date: utcMidnight(day),
          countryCode: "KR",
          pointCount: 1,
          airportPointCount: 0,
          spanKm: 0,
        },
      });
      await prisma.travTrackDirtyDay.create({
        data: { userId, day: utcMidnight(day), version: 1, done: 7 },
      });
    }
    await prisma.travTrackMonthValue.create({
      data: {
        userId,
        month: utcMidnight("2026-10-01"),
        kmGround: 3,
        countries: ["KR"],
        daysWithData: 1,
        daysPaused: 0,
        algorithm: 1,
      },
    });

    expect((await del(id)).status).toBe(200);

    const left = await prisma.countryDay.findMany({ where: { userId }, select: { date: true } });
    expect(left.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-10-13"]);
    expect(await prisma.travTrackMonthValue.count({ where: { userId } })).toBe(0);
    const dirty = await prisma.travTrackDirtyDay.findMany({
      where: { userId },
      orderBy: { day: "asc" },
      select: { day: true, done: true, version: true },
    });
    expect(dirty.map((d) => [d.day.toISOString().slice(0, 10), d.done, Number(d.version)])).toEqual(
      [
        ["2026-10-09", 0, 2],
        ["2026-10-10", 0, 2],
        ["2026-10-11", 0, 2],
        ["2026-10-13", 7, 1],
      ]
    );
  });

  it("a shared trip's route loses exactly that vertex", async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await shareSnapshotBuildLimiter.resetKey(`user:${userId}`);
    const tripId = await makeTrip(userId);
    const start = Date.parse("2026-10-12T05:00:00Z");
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(
        await storePoint(userId, {
          t: start + i * 60_000,
          lat: 37.5 + (i % 2) * 0.001,
          lon: 127.0 + i * 0.002,
        })
      );
    }
    await request(app)
      .put(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", cookie)
      .expect(200);
    const times = async () => {
      const row = await prisma.travTrackShareSnapshot.findUniqueOrThrow({ where: { tripId } });
      return (row.geometry as number[][][]).flat().map((v) => v[2]);
    };
    const before = await times();
    const target = start + 7 * 60_000;
    expect(before).toContain(target);

    expect((await del(ids[7])).status).toBe(200);

    expect(await times()).toEqual(before.filter((t) => t !== target));
    await prisma.trip.deleteMany({ where: { userId } });
  });

  it("another account's point is 404 and stays; so is an unknown or malformed id", async () => {
    const theirs = await storePoint(otherId, { t: T, ...SEOUL });

    const res = await del(theirs);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRAVTRACK_POINT_NOT_FOUND");
    expect(await prisma.travTrackPoint.findUnique({ where: { id: theirs } })).not.toBeNull();
    expect((await del("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await del("not-a-point")).status).toBe(404);
  });

  it("a second delete of the same point is 404", async () => {
    const id = await storePoint(userId, { t: T, ...SEOUL });
    expect((await del(id)).status).toBe(200);
    expect((await del(id)).status).toBe(404);
  });

  it("stays reachable with TravTrack off while the account holds data", async () => {
    const id = await storePoint(userId, { t: T, ...SEOUL });
    await storePoint(userId, { t: T + 60_000, ...SEOUL, lat: SEOUL.lat + 0.001 });
    await switches.set({ beta: true, config: false });
    expect((await del(id)).status).toBe(200);
  });

  it("the day read names each vertex's stored point, aligned with the segments", async () => {
    const a = await storePoint(userId, { t: T, ...SEOUL });
    const b = await storePoint(userId, { t: T + 60_000, lat: SEOUL.lat + 0.001, lon: SEOUL.lon });

    const res = await request(app)
      .get("/api/v1/travtrack/day")
      .query({ date: "2026-10-10" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.segments).toHaveLength(1);
    expect(res.body.pointIds).toEqual([[a, b]]);
  });
});

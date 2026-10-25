/**
 * Every removal path runs E5's handlers (TravTrack plan E5): through the app,
 * so a registration only a test made cannot pass. Each removal raises the
 * history generation and takes the open findings of the removed history with
 * it; a scan or a question run that read before the removal publishes nothing
 * after it — without any test calling `bumpHistoryGeneration` itself.
 */
import request from "supertest";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import { reserveScan, scanStays } from "../../dawarich/stays/scan";
import { utcMidnight } from "../../countryDays/store";
import { countrySuggestions } from "../../locationEvidence/countrySuggestions";
import { historyGeneration } from "../../locationEvidence/generation";
import {
  BASE,
  MIN,
  NOW,
  SEOUL,
  evidenceAccount,
  holdTravTrackLock,
  range,
  storeMinutes,
  untilSomeoneWaitsForTheLock,
} from "../../locationEvidence/__tests__/evidenceFixtures";
import { deleteTravTrackRange } from "../deleteRange";
import { wipeTravTrack } from "./fixtures";
import { travTrackSwitches } from "./switches";

jest.mock("../../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

import app from "../../../index";

const PREFIX = "travtrack-removal-handlers-";
const switches = travTrackSwitches();
let userId: string;
let cookie: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  await switches.set({ beta: true, config: true });
  userId = await evidenceAccount(`${PREFIX}a`);
  cookie = `auth_token=${generateToken(userId)}`;
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await wipeTravTrack([userId]);
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.locationSuggestion.deleteMany({ where: { userId } });
  await prisma.countryDay.deleteMany({ where: { userId } });
  await prisma.travTrackImport.deleteMany({ where: { userId } });
  await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.update({ where: { userId }, data: { leaseUntil: null } });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

const generation = () => prisma.$transaction((tx) => historyGeneration(tx, userId));

/** A 30-minute stop in Seoul, scanned into one pending finding. */
async function finding() {
  await storeMinutes(userId, range(0, 30, 10));
  await reserveScan(userId, NOW);
  await scanStays(userId, { now: NOW });
  return prisma.dawarichStay.findFirstOrThrow({ where: { userId, status: "pending" } });
}

const gone = async (id: string) =>
  (await prisma.dawarichStay.findUnique({ where: { id } })) === null;

describe("every removal path runs the handler", () => {
  it("DELETE /travtrack/points by instants", async () => {
    const row = await finding();
    const before = await generation();
    const res = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({
        from: new Date(BASE - MIN).toISOString(),
        to: new Date(BASE + 60 * MIN).toISOString(),
      })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await gone(row.id)).toBe(true);
    expect(await generation()).toBe(before + 1n);
  });

  it("DELETE /travtrack/points by days", async () => {
    const row = await finding();
    const before = await generation();
    const res = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({ fromDay: "2026-10-09", toDay: "2026-10-11" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await gone(row.id)).toBe(true);
    expect(await generation()).toBe(before + 1n);
  });

  it("POST /travtrack/zones", async () => {
    const row = await finding();
    const before = await generation();
    const res = await request(app)
      .post("/api/v1/travtrack/zones")
      .set("Cookie", cookie)
      .send({ name: "Home", ...SEOUL, radiusM: 200, deleteStoredPoints: true });
    expect(res.status).toBe(201);
    expect(res.body.deleted).toBe(4);
    expect(await gone(row.id)).toBe(true);
    expect(await generation()).toBe(before + 1n);
  });

  it("PATCH /travtrack/zones/:id with deleteStoredPoints", async () => {
    const created = await request(app)
      .post("/api/v1/travtrack/zones")
      .set("Cookie", cookie)
      .send({ name: "Work", lat: 35.1, lon: 129.04, radiusM: 200 });
    expect(created.status).toBe(201);
    const row = await finding();
    const before = await generation();
    const res = await request(app)
      .patch(`/api/v1/travtrack/zones/${created.body.zone.id}`)
      .set("Cookie", cookie)
      .send({ ...SEOUL, deleteStoredPoints: true });
    expect(res.status).toBe(200);
    expect(await gone(row.id)).toBe(true);
    expect(await generation()).toBe(before + 1n);
  });

  it("DELETE /travtrack/imports/:id", async () => {
    const imported = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "walk.gpx", status: "succeeded" },
    });
    // The stop's fixes came from the file.
    await storeMinutes(userId, range(0, 30, 10));
    await prisma.travTrackPoint.updateMany({
      where: { userId },
      data: { origin: `gpx:${imported.id}`, deviceId: `file:${imported.id}` },
    });
    await reserveScan(userId, NOW);
    await scanStays(userId, { now: NOW });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    const before = await generation();
    const res = await request(app)
      .delete(`/api/v1/travtrack/imports/${imported.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await gone(row.id)).toBe(true);
    expect(await generation()).toBe(before + 1n);
  });
});

describe("a run that read before a removal", () => {
  it("a deletion during a held scan: the scan publishes nothing", async () => {
    await storeMinutes(userId, range(0, 30, 10));
    await reserveScan(userId, NOW);
    const release = await holdTravTrackLock(userId);
    const scan = scanStays(userId, { now: NOW });
    // The scan has read and waits to publish under the lock.
    await untilSomeoneWaitsForTheLock();
    await release(async (tx) => {
      await deleteTravTrackRange(userId, new Date(BASE - MIN), new Date(BASE + 60 * MIN), tx);
    });
    expect(await scan).toMatchObject({ created: 0, stale: true });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });

  it("a deletion between a country run's read and its publication: nothing is asked", async () => {
    for (const day of ["2026-10-10", "2026-10-11"]) {
      await prisma.countryDay.create({
        data: {
          userId,
          source: "travtrack",
          date: utcMidnight(day),
          countryCode: "PT",
          pointCount: 10,
          airportPointCount: 0,
          spanKm: 1,
        },
      });
    }
    // A point elsewhere in time: the removal deletes no country day.
    await storeMinutes(userId, [60 * 24 * 30]);
    const result = await countrySuggestions(userId, {
      afterRead: async () => {
        await deleteTravTrackRange(
          userId,
          new Date(BASE + 60 * 24 * 29 * MIN),
          new Date(BASE + 60 * 24 * 31 * MIN)
        );
      },
    });
    expect(result).toMatchObject({ status: "stale", created: 0 });
    expect(await prisma.locationSuggestion.count({ where: { userId } })).toBe(0);
  });
});

import { Prisma } from "../../prisma";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * A stay the user already recorded is not a finding (prod, 2026-10-16: 30 of
 * 51 open stays sat on a visit logged live in Korea; accepting one recorded
 * the visit twice).
 *
 * The stop runs 14:50–15:20 UTC, 23:50–00:20 in Seoul: across local midnight,
 * and nine hours from its own wall clock, which is what a compare on the
 * fake-UTC `visitedAt` column would get wrong.
 */
const SEOUL = { lat: 37.57, lon: 126.97 };
const now = new Date("2026-10-11T06:00:00Z");
let nextId = 1;
function stop(at: { lat: number; lon: number }, startIso: string, minutes: number) {
  const points: DawarichPoint[] = [];
  for (let m = 0; m <= minutes; m += 10)
    points.push({
      id: nextId++,
      latitude: at.lat,
      longitude: at.lon,
      timestampMs: Date.parse(startIso) + m * 60_000,
      accuracy: 10,
      altitude: null,
      velocity: null,
      trackId: null,
    });
  return points;
}
const clientOf = (points: DawarichPoint[]): DawarichClient => ({
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
});
const seoulStop = () => stop(SEOUL, "2026-10-10T14:50:00Z", 30);
/** ~60 m north of the stop. */
const NEAR = { lat: SEOUL.lat + 0.00054, lon: SEOUL.lon };
/** ~400 m north. */
const FAR = { lat: SEOUL.lat + 0.0036, lon: SEOUL.lon };

let userId: string;
let cookie: string;

async function scan(points: DawarichPoint[] = seoulStop()) {
  await reserveScan(userId);
  return scanStays(userId, { now, client: clientOf(points) });
}

async function visitAt(
  at: { lat: number; lon: number },
  columns: {
    visitedAt: string;
    visitedAtUtc: string | null;
    visitedPrecision: "minute" | "day";
  }
) {
  const place = await prisma.place.create({ data: { userId, name: "War Memorial", ...at } });
  return prisma.placeVisit.create({
    data: {
      userId,
      placeId: place.id,
      visitedAt: new Date(columns.visitedAt),
      visitedAtUtc: columns.visitedAtUtc ? new Date(columns.visitedAtUtc) : null,
      visitedZone: "Asia/Seoul",
      visitedPrecision: columns.visitedPrecision,
    },
  });
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-cover-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, enabledDomains: ["poi"], data: {} },
    update: { enabledDomains: ["poi"], dawarichBaseUrl: null, dawarichApiKey: null, data: {} },
  });
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.lodgingStay.deleteMany({ where: { userId } });
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: {
      enabled: true,
      marketEnabled: false,
      venueEnabled: false,
      marketResult: Prisma.DbNull,
      leaseUntil: null,
      result: null,
    },
  });
});

describe("Dawarich stays already recorded by a visit or a hotel stay", () => {
  it("does not suggest a stop a minute-precise visit nearby already holds", async () => {
    // Logged at 23:48 Seoul — two minutes before the dot settled, 60 m away.
    await visitAt(NEAR, {
      visitedAt: "2026-10-10T23:48:00Z",
      visitedAtUtc: "2026-10-10T14:48:00Z",
      visitedPrecision: "minute",
    });
    const result = await scan();
    expect(result).toMatchObject({ created: 0, covered: 1 });
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });

  it("compares the visit's real instant, not its wall clock read as UTC", async () => {
    // A visit at 14:52 Seoul wall time — the stay's UTC digits, nine hours
    // before it. A naive compare on `visitedAt` would call this the same stop.
    await visitAt(NEAR, {
      visitedAt: "2026-10-10T14:52:00Z",
      visitedAtUtc: "2026-10-10T05:52:00Z",
      visitedPrecision: "minute",
    });
    expect(await scan()).toMatchObject({ created: 1, covered: 0 });
  });

  it("keeps a stop whose nearby visit is 400 m away", async () => {
    await visitAt(FAR, {
      visitedAt: "2026-10-10T23:52:00Z",
      visitedAtUtc: "2026-10-10T14:52:00Z",
      visitedPrecision: "minute",
    });
    expect(await scan()).toMatchObject({ created: 1, covered: 0 });
  });

  it("counts a day-dated visit on the stop's local day", async () => {
    // 2026-10-11 is the Seoul day the stop ends on; in UTC it is the 10th.
    await visitAt(NEAR, {
      visitedAt: "2026-10-11T00:00:00Z",
      visitedAtUtc: "2026-10-10T15:00:00Z",
      visitedPrecision: "day",
    });
    expect(await scan()).toMatchObject({ created: 0, covered: 1 });
  });

  it("does not suggest the user's own hotel during the stay there", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Lotte Hotel Seoul", ...NEAR },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkInDate: new Date("2026-10-09T00:00:00Z"),
        checkOutDate: new Date("2026-10-11T00:00:00Z"),
      },
    });
    expect(await scan()).toMatchObject({ created: 0, covered: 1 });
  });

  it("resolves a pending finding as covered once the visit is logged, and says by what", async () => {
    expect(await scan()).toMatchObject({ created: 1 });
    // Logged afterwards, live on the phone.
    const visit = await visitAt(NEAR, {
      visitedAt: "2026-10-10T23:55:00Z",
      visitedAtUtc: "2026-10-10T14:55:00Z",
      visitedPrecision: "minute",
    });

    const pending = await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toEqual([]);

    const covered = await request(app)
      .get("/api/v1/dawarich-stays?status=covered")
      .set("Cookie", cookie);
    expect(covered.status).toBe(200);
    expect(covered.body.data).toHaveLength(1);
    expect(covered.body.data[0].status).toBe("covered");
    expect(covered.body.data[0].resolvedAt).not.toBeNull();
    expect(covered.body.data[0].evidence.coveredBy).toMatchObject({
      kind: "visit",
      id: visit.id,
      name: "War Memorial",
    });

    // Neither a later scan nor an accept brings it back or records it twice.
    await scan();
    expect(await prisma.dawarichStay.count({ where: { userId, status: "pending" } })).toBe(0);
    const accept = await request(app)
      .post(`/api/v1/dawarich-stays/${covered.body.data[0].id}/accept`)
      .set("Cookie", cookie)
      .send({
        name: "War Memorial",
        placeId: null,
        tripId: null,
        ...SEOUL,
        startAt: { local: "2026-10-10T23:50" },
        endAt: { local: "2026-10-11T00:20" },
      });
    expect(accept.status).toBe(409);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });
});

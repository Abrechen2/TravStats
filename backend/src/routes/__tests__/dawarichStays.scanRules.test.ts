import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
// A position the zone resolver cannot place is rare on land; it is forced here
// for one marker latitude so one candidate of a scan has no zone.
const NO_ZONE_LAT = 10.5;
jest.mock("../../shared/time/zoneOf", () => {
  const actual = jest.requireActual("../../shared/time/zoneOf");
  return {
    ...actual,
    zoneOf: jest.fn((place: { lat?: number | null }) =>
      place.lat !== undefined && place.lat !== null && Math.abs(place.lat - NO_ZONE_LAT) < 0.01
        ? null
        : actual.zoneOf(place)
    ),
  };
});

/**
 * Scan-side defects of the Dawarich stay findings (fix/ct142-places): what a
 * scan skips, suppresses, extends, and which trip it names.
 */
const SEOUL = { lat: 37.57, lon: 126.97 };
const now = new Date("2026-10-11T06:00:00Z");
let nextId = 1;
/** A stationary run of points every ten minutes from `startIso`. */
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
let userId: string;

async function scan(points: DawarichPoint[]) {
  await reserveScan(userId);
  return scanStays(userId, { now, client: clientOf(points) });
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-rules-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
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
  await prisma.trip.deleteMany({ where: { userId } });
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

describe("a candidate without a zone", () => {
  it("is skipped and counted; the rest of the scan still lands", async () => {
    const result = await scan([
      ...stop(SEOUL, "2026-10-10T03:00:00Z", 30),
      ...stop({ lat: NO_ZONE_LAT, lon: 120 }, "2026-10-10T08:00:00Z", 30),
    ]);
    expect(result.created).toBe(1);
    expect(result.skippedNoZone).toBe(1);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.result).toBe("succeeded");
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
  });
});

describe("daily places", () => {
  it("never suggests a stay at the confirmed home", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: {
        data: {
          homePeriods: [
            {
              fromDate: "2020-01-01",
              toDate: null,
              residence: { name: "Jongno", lat: SEOUL.lat + 0.001, lon: SEOUL.lon },
              residenceConfirmed: true,
              airports: [{ code: "ICN", primary: true }],
            },
          ],
        },
      },
    });
    const result = await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30));
    expect(result.created).toBe(0);
    expect(result.suppressed).toBe(1);
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });

  it("still suggests a stay near an unconfirmed (airport-derived) home", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: {
        data: {
          homePeriods: [
            {
              fromDate: "2020-01-01",
              toDate: null,
              residence: { name: "Incheon", lat: SEOUL.lat, lon: SEOUL.lon },
              residenceConfirmed: false,
              airports: [{ code: "ICN", primary: true }],
            },
          ],
        },
      },
    });
    expect((await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30))).created).toBe(1);
  });

  async function rejectedAt(at: { lat: number; lon: number }, day: string) {
    await prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: `rejected-${day}`,
        status: "rejected",
        sourceStartAt: new Date(`${day}T03:00:00Z`),
        sourceEndAt: new Date(`${day}T04:00:00Z`),
        sourceLat: at.lat,
        sourceLon: at.lon,
        startAt: new Date(`${day}T03:00:00Z`),
        endAt: new Date(`${day}T04:00:00Z`),
        lat: at.lat,
        lon: at.lon,
        zone: "Asia/Seoul",
        pointCount: 4,
        evidence: { source: "dawarich" },
        resolvedAt: new Date(`${day}T12:00:00Z`),
      },
    });
  }

  it("stops asking about a place rejected twice within reach", async () => {
    await rejectedAt({ lat: SEOUL.lat + 0.0005, lon: SEOUL.lon }, "2026-10-01");
    await rejectedAt({ lat: SEOUL.lat, lon: SEOUL.lon + 0.0005 }, "2026-10-03");
    const result = await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30));
    expect(result.created).toBe(0);
    expect(result.suppressed).toBe(1);
  });

  it("asks again after a single rejection", async () => {
    await rejectedAt(SEOUL, "2026-10-01");
    expect((await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30))).created).toBe(1);
  });
});

describe("a stay still going on at scan time", () => {
  it("grows its pending finding instead of freezing at the first end", async () => {
    const early = stop(SEOUL, "2026-10-10T03:00:00Z", 30);
    await scan(early);
    const first = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(first.sourceEndAt.toISOString()).toBe("2026-10-10T03:30:00.000Z");
    const later = [...early, ...stop(SEOUL, "2026-10-10T03:40:00Z", 60)];
    const result = await scan(later);
    expect(result.created).toBe(0);
    const rows = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].sourceStartAt.toISOString()).toBe("2026-10-10T03:00:00.000Z");
    expect(rows[0].sourceEndAt.toISOString()).toBe("2026-10-10T04:40:00.000Z");
    expect(rows[0].endAt.toISOString()).toBe("2026-10-10T04:40:00.000Z");
    expect(rows[0].pointCount).toBe(later.length);
  });

  it("leaves a resolved finding as the user decided it", async () => {
    const early = stop(SEOUL, "2026-10-10T03:00:00Z", 30);
    await scan(early);
    await prisma.dawarichStay.updateMany({ where: { userId }, data: { status: "rejected" } });
    await scan([...early, ...stop(SEOUL, "2026-10-10T03:40:00Z", 60)]);
    const rows = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceEndAt.toISOString()).toBe("2026-10-10T03:30:00.000Z");
  });
});

describe("the trip a stay falls in", () => {
  it("reads a legacy trip anchor by the shared day rule, not its UTC date", async () => {
    // Written by a UTC+2 browser before the time model: local midnight of
    // 10 October is stored as 9 October 22:00 UTC.
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Seoul day",
        startDate: new Date("2026-10-09T22:00:00Z"),
        endDate: new Date("2026-10-09T22:00:00Z"),
      },
    });
    await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30));
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(row.tripId).toBe(trip.id);
  });
});

describe("an unexpected scan failure", () => {
  it("is logged with its cause before the generic answer goes out", async () => {
    const spy = jest.spyOn(logger, "error");
    const cause = new Error("connection terminated");
    await reserveScan(userId);
    await expect(
      scanStays(userId, {
        now,
        client: {
          checkHealth: async () => ({ reachable: true, version: null }),
          getPoints: async () => {
            throw cause;
          },
        },
      })
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "dawarich_stay_scan_error", userId, err: cause }),
      expect.any(String)
    );
    spy.mockRestore();
  });
});

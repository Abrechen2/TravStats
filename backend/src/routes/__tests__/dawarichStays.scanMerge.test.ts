import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
/**
 * A rescan that re-reads a stay keeps what the stop was already told (plugin
 * answers, the name), and fragments of one stay an older detector split are
 * replaced by the one stay (prod, 24./25.11.2026).
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
  // Area recognition is always on: an unstubbed scan would reach the network.
  return scanStays(userId, {
    now,
    client: clientOf(points),
    marketFetcher: async () => Response.json({ elements: [] }),
  });
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-merge-${Date.now()}`, passwordHash: "synthetic-test-hash" },
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

const fragment = (
  fromIso: string,
  toIso: string,
  extra: { name?: string; evidence?: object } = {}
) =>
  prisma.dawarichStay.create({
    data: {
      userId,
      fingerprint: `frag-${fromIso}`,
      sourceStartAt: new Date(fromIso),
      sourceEndAt: new Date(toIso),
      sourceLat: SEOUL.lat,
      sourceLon: SEOUL.lon,
      startAt: new Date(fromIso),
      endAt: new Date(toIso),
      lat: SEOUL.lat,
      lon: SEOUL.lon,
      zone: "Asia/Seoul",
      pointCount: 4,
      evidence: { source: "dawarich", ...(extra.evidence ?? {}) },
      name: extra.name ?? null,
      provider: "dawarich",
    },
  });
const answer = {
  pluginId: "p1",
  pluginName: "Projektarchiv",
  name: "MSA Zentralküche",
  confidence: 0.9,
};

describe("a rescan keeps what the stop was told", () => {
  it("a grown finding keeps its plugin answers and its name", async () => {
    const early = stop(SEOUL, "2026-10-10T03:00:00Z", 30);
    await scan(early);
    const first = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    await prisma.dawarichStay.update({
      where: { id: first.id },
      data: {
        name: "MSA Menüservice Allgäu",
        evidence: {
          ...(first.evidence as object),
          plugins: [answer],
          suggestedPurpose: "business",
        },
      },
    });
    await scan([...early, ...stop(SEOUL, "2026-10-10T03:40:00Z", 60)]);
    const [row] = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(row.sourceEndAt.toISOString()).toBe("2026-10-10T04:40:00.000Z");
    expect(row.name).toBe("MSA Menüservice Allgäu");
    expect(row.evidence).toMatchObject({ plugins: [answer], suggestedPurpose: "business" });
  });
});

describe("fragments of one stay", () => {
  it("are replaced by the one stay, which carries their answers and name", async () => {
    const a = await fragment("2026-10-10T03:00:00Z", "2026-10-10T03:50:00Z", {
      evidence: { plugins: [answer] },
    });
    const b = await fragment("2026-10-10T03:51:00Z", "2026-10-10T05:00:00Z", {
      name: "MSA Menüservice Allgäu",
    });
    const result = await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 120));
    expect(result.created).toBe(1);
    const open = await prisma.dawarichStay.findMany({ where: { userId, status: "pending" } });
    expect(open).toHaveLength(1);
    expect(open[0].sourceEndAt.toISOString()).toBe("2026-10-10T05:00:00.000Z");
    expect(open[0].name).toBe("MSA Menüservice Allgäu");
    expect(open[0].evidence).toMatchObject({ plugins: [answer], mergedFindingIds: [a.id, b.id] });
    const gone = await prisma.dawarichStay.findMany({ where: { userId, status: "superseded" } });
    expect(gone.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("stay split when one of them was answered", async () => {
    await fragment("2026-10-10T03:00:00Z", "2026-10-10T03:50:00Z");
    const b = await fragment("2026-10-10T03:51:00Z", "2026-10-10T05:00:00Z");
    await prisma.dawarichStay.update({ where: { id: b.id }, data: { status: "rejected" } });
    const result = await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 120));
    expect(result.created).toBe(0);
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(2);
  });
});

describe("a rescan keeps a visit finding's venue", () => {
  it("grows a stay.stop finding without dropping its `visit` evidence", async () => {
    const early = stop(SEOUL, "2026-10-10T03:00:00Z", 30);
    await scan(early);
    const first = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    const visit = { venue: { name: "Bürohaus", source: "osm" }, durationMs: 1_800_000 };
    await prisma.dawarichStay.update({
      where: { id: first.id },
      data: { evidence: { ...(first.evidence as object), visit } },
    });
    await scan([...early, ...stop(SEOUL, "2026-10-10T03:40:00Z", 60)]);
    const [row] = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(row.sourceEndAt.toISOString()).toBe("2026-10-10T04:40:00.000Z");
    expect(row.evidence).toMatchObject({ visit });
  });
});

describe("a stay beside the owner's own places", () => {
  const north = (m: number) => ({ lat: SEOUL.lat + m / 111_195, lon: SEOUL.lon });
  const place = (name: string, at: { lat: number; lon: number }) =>
    prisma.place.create({ data: { userId, name, ...at } });

  it("is named after the nearest one within the stay radius, even with a second close by", async () => {
    await place("McDonald's Hepberg", north(140));
    await place("Tankstelle", north(145));
    await scan(stop(SEOUL, "2026-10-10T03:00:00Z", 30));
    const [row] = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(row.name).toBe("McDonald's Hepberg");
  });

  it("names a nameless open finding the next rescan reaches", async () => {
    const early = stop(SEOUL, "2026-10-10T03:00:00Z", 30);
    await scan(early);
    expect((await prisma.dawarichStay.findFirstOrThrow({ where: { userId } })).name).toBeNull();
    await place("Gasthof Post", north(12));
    await scan(early);
    const [row] = await prisma.dawarichStay.findMany({ where: { userId } });
    expect(row.name).toBe("Gasthof Post");
  });
});

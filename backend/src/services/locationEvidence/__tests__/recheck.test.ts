/**
 * Re-checking a TravTrack finding's evidence on accept (TravTrack plan E4):
 * by the kind's own detector rules, over the finding's window ± 30 minutes,
 * against the history as it is now.
 */
import { prisma } from "../../../db";
import { reserveScan, scanStays } from "../../dawarich/stays/scan";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { wipeTravTrack } from "../../travtrack/__tests__/fixtures";
import { recheckFinding } from "../recheck";
import {
  BASE,
  MIN,
  NOW,
  evidenceAccount,
  marketRaw,
  range,
  storeMinutes,
} from "./evidenceFixtures";

const PREFIX = "evidence-recheck-";
const switches = travTrackSwitches();
let userId: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  await switches.set({ beta: true, config: true });
  userId = await evidenceAccount(`${PREFIX}a`);
});

beforeEach(async () => {
  await wipeTravTrack([userId]);
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.update({
    where: { userId },
    data: { leaseUntil: null, marketEnabled: false },
  });
});

afterAll(async () => {
  await switches.restore();
  await prisma.marketCatalogTile.deleteMany({});
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

async function scan(options: Parameters<typeof scanStays>[1] = {}) {
  await reserveScan(userId, NOW);
  await scanStays(userId, { now: NOW, ...options });
  return prisma.dawarichStay.findFirstOrThrow({ where: { userId, status: "pending" } });
}

const deleteMinutes = (from: number, to: number) =>
  prisma.travTrackPoint.deleteMany({
    where: { userId, t: { gte: new Date(BASE + from * MIN), lte: new Date(BASE + to * MIN) } },
  });

describe("recheckFinding", () => {
  it("a stay whose points are all still there holds, and names the generation it read", async () => {
    await storeMinutes(userId, range(0, 60, 10));
    const row = await scan();
    const result = await recheckFinding(userId, row);
    expect(result.outcome).toBe("holds");
    expect(typeof result.generation).toBe("bigint");
  });

  it("a stay whose points now have a 40-minute gap no longer holds", async () => {
    await storeMinutes(userId, range(0, 60, 10));
    const row = await scan();
    await deleteMinutes(20, 40);
    expect((await recheckFinding(userId, row)).outcome).toBe("invalidated");
  });

  it("a stay whose points are gone no longer holds", async () => {
    await storeMinutes(userId, range(0, 60, 10));
    const row = await scan();
    await deleteMinutes(0, 60);
    expect((await recheckFinding(userId, row)).outcome).toBe("invalidated");
  });

  it("a venue whose points still last the market duration holds", async () => {
    await storeMinutes(userId, range(0, 20));
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const row = await scan({ marketFetcher: jest.fn(async () => Response.json(marketRaw)) });
    expect((row.evidence as { kind?: string }).kind).toBe("market");
    expect((await recheckFinding(userId, row)).outcome).toBe("holds");
  });

  it("a venue whose points now have gaps beyond the venue rule no longer holds", async () => {
    await storeMinutes(userId, range(0, 20));
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const row = await scan({ marketFetcher: jest.fn(async () => Response.json(marketRaw)) });
    await deleteMinutes(3, 15);
    expect((await recheckFinding(userId, row)).outcome).toBe("invalidated");
  });

  it("a venue whose map area is no longer cached is unverifiable — never accepted on a weaker rule", async () => {
    await storeMinutes(userId, range(0, 20));
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const row = await scan({ marketFetcher: jest.fn(async () => Response.json(marketRaw)) });
    // Gaps of 14 minutes, beyond the venue's 10: the detector would say no.
    await deleteMinutes(3, 15);
    await prisma.marketCatalogTile.deleteMany({});
    expect((await recheckFinding(userId, row)).outcome).toBe("unverifiable");
  });

  it("a venue whose points no longer last the market duration no longer holds", async () => {
    await storeMinutes(userId, range(0, 20));
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const row = await scan({ marketFetcher: jest.fn(async () => Response.json(marketRaw)) });
    await deleteMinutes(3, 20);
    expect((await recheckFinding(userId, row)).outcome).toBe("invalidated");
  });
});

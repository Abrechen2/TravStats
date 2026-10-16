import { prisma } from "../../../db";
import { backfillVisitedFlags } from "../visitedFlagBackfill";

/**
 * The repair for places a past visit should have marked visited (the KST
 * defect, 2026-10). It must promote exactly the rows the fixed write path
 * would have promoted, and nothing a user may have meant to leave unvisited.
 */
const USER = "visitedflagbackfill";
const NOW = new Date("2026-10-16T12:00:00.000Z");
const HOUR = 3_600_000;
const SEOUL = { lat: 37.5796, lon: 126.977, category: "landmark" };

describe("backfillVisitedFlags", () => {
  let userId: string;
  const ids: Record<string, string> = {};

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  const place = async (
    key: string,
    visit: { at: Date | null; createdAt: Date } | null,
    extra: { curatedItemId?: string; visited?: boolean } = {}
  ): Promise<void> => {
    const p = await prisma.place.create({
      data: { userId, name: key, ...SEOUL, visited: extra.visited ?? false, ...extra },
    });
    ids[key] = p.id;
    if (!visit) return;
    await prisma.placeVisit.create({
      data: {
        placeId: p.id,
        userId,
        // The legacy column is the Seoul wall clock: nine hours ahead.
        visitedAt: visit.at ? new Date(visit.at.getTime() + 9 * HOUR) : null,
        visitedAtUtc: visit.at,
        visitedZone: visit.at ? "Asia/Seoul" : null,
        visitedPrecision: visit.at ? "minute" : null,
        writtenVia: "companion",
        createdAt: visit.createdAt,
      },
    });
  };

  beforeAll(async () => {
    await cleanup();
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    const anHourAgo = new Date(NOW.getTime() - HOUR);
    // The defect: logged a minute after it happened, flag never set.
    await place("broken", { at: anHourAgo, createdAt: new Date(anHourAgo.getTime() + 60_000) });
    // A plan entered last week that has come due: no proof anyone went.
    await place("cameDue", { at: anHourAgo, createdAt: new Date(NOW.getTime() - 7 * 24 * HOUR) });
    // Unticked checklist row: the untick keeps visits on purpose.
    await place("unticked", { at: anHourAgo, createdAt: NOW }, { curatedItemId: "whc-test-1" });
    await place("undated", { at: null, createdAt: NOW });
    await place("future", { at: new Date(NOW.getTime() + HOUR), createdAt: NOW });
    await place("wishlist", null);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const visited = async (key: string): Promise<boolean> =>
    (await prisma.place.findUniqueOrThrow({ where: { id: ids[key] } })).visited;

  it("a dry run names only the broken place and writes nothing", async () => {
    const report = await backfillVisitedFlags({ apply: false, userId, now: NOW });
    expect(report.candidates.map((c) => c.placeName)).toEqual(["broken"]);
    expect(report.promoted).toBe(0);
    expect(await visited("broken")).toBe(false);
  });

  it("apply promotes it and leaves every other place as it was; a second run is a no-op", async () => {
    const first = await backfillVisitedFlags({ apply: true, userId, now: NOW });
    expect(first.promoted).toBe(1);
    expect(await visited("broken")).toBe(true);
    for (const key of ["cameDue", "unticked", "undated", "future", "wishlist"]) {
      expect(await visited(key)).toBe(false);
    }
    const second = await backfillVisitedFlags({ apply: true, userId, now: NOW });
    expect(second.candidates).toEqual([]);
    expect(second.promoted).toBe(0);
  });
});

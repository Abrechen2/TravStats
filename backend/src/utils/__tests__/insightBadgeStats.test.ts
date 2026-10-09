import { prisma } from "../../db";
import * as insights from "../../services/stats/insights";
import { calculateInsightBadgeStats } from "../insightAchievements";
import { checkAndUpdateAchievements } from "../achievements";
import { ensureAchievements } from "../../data/achievements";

/**
 * Review I4: one badge check reads each source ONCE — the tours a single time,
 * without elevation profiles — and a source that throws is logged and skipped
 * instead of aborting every badge update for the user.
 */
const USER = "insightbadgestats";

describe("calculateInsightBadgeStats", () => {
  let userId: string;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.tripRoute.create({
      data: {
        userId,
        name: "Hike",
        mode: "foot",
        kind: "tour",
        activity: "hike",
        tourDate: new Date("2024-05-01T00:00:00Z"),
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("loads the tours once, without elevation profiles, for both tour and roadtrip badges", async () => {
    const load = jest.spyOn(insights, "loadTourFacts");
    const stats = await calculateInsightBadgeStats(userId);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][2]).toEqual({ withElevation: false });
    expect(stats.insightStats.tourCount).toBe(1);
    expect(stats.roadtripStats).not.toBeNull();
  });

  it("skips a source that throws and keeps the badge it had already earned", async () => {
    await checkAndUpdateAchievements(userId);
    const before = await prisma.userAchievement.findFirstOrThrow({
      where: { userId, achievement: { code: "TOUR_FIRST_STEPS" } },
    });
    expect(before.unlockedAt).not.toBeNull();

    jest.spyOn(insights, "tourInsights").mockRejectedValue(new Error("bad row"));
    jest.spyOn(insights, "roadtripInsights").mockRejectedValue(new Error("bad row"));
    const stats = await calculateInsightBadgeStats(userId);
    expect(stats.insightStats.tourCount).toBeNull();
    expect(stats.roadtripStats).toBeNull();

    // The whole check still runs, and the earned badge is untouched.
    await expect(checkAndUpdateAchievements(userId)).resolves.toBeDefined();
    const after = await prisma.userAchievement.findFirstOrThrow({
      where: { userId, achievement: { code: "TOUR_FIRST_STEPS" } },
    });
    expect(after.progress).toBe(before.progress);
    expect(after.unlockedAt).toEqual(before.unlockedAt);
  });
});

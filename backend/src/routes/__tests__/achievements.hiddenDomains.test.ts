import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * Acceptance D4 (2026-09-26): with the beta switch OFF the achievements page
 * read "75 of 275" but "6,200 points" — the points still carried the hidden
 * rail badges — and the statistics overview counted "81 achievements". Both
 * read `GET /achievements`; the leaderboard sums the same rows. A badge of a
 * hidden domain is now neither listed, counted nor scored, in one place.
 */
describe("achievements of a hidden domain", () => {
  const username = "ach-hidden-domain";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;
  let flightPoints: number;
  let railPoints: number;
  let railCode: string;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rail"], data: {} },
    });

    const flight = await prisma.achievement.findFirstOrThrow({
      where: { domain: "flight", code: { not: { startsWith: "TEST_" } } },
      orderBy: { code: "asc" },
    });
    const rail = await prisma.achievement.findFirstOrThrow({
      where: { domain: "rail" },
      orderBy: { code: "asc" },
    });
    flightPoints = flight.points;
    railPoints = rail.points;
    railCode = rail.code;
    for (const a of [flight, rail]) {
      await prisma.userAchievement.create({
        data: {
          userId,
          achievementId: a.id,
          progress: a.requirement,
          unlockedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
    }
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  const summary = async (): Promise<{
    body: {
      summary: { totalPoints: number; unlockedAchievements: number; totalAchievements: number };
      achievements: { code: string }[];
    };
  }> => request(app).get("/api/v1/achievements").set("Cookie", cookie);

  it("leaves a hidden domain's badges out of the list, the count and the points", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const { body } = await summary();

    expect(body.summary.totalPoints).toBe(flightPoints);
    expect(body.summary.unlockedAchievements).toBe(1);
    expect(body.achievements.map((a) => a.code)).not.toContain(railCode);

    const recent = await request(app).get("/api/v1/achievements/recent").set("Cookie", cookie);
    expect(recent.body.achievements).toHaveLength(1);

    const board = await request(app)
      .get("/api/v1/achievements/leaderboard?limit=100")
      .set("Cookie", cookie);
    const mine = board.body.leaderboard.find((e: { username: string }) => e.username === username);
    expect(mine).toMatchObject({ totalPoints: flightPoints, achievementCount: 1 });
  });

  it("counts them again once the domain is visible — the badges were kept", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const { body } = await summary();

    expect(body.summary.totalPoints).toBe(flightPoints + railPoints);
    expect(body.summary.unlockedAchievements).toBe(2);
    expect(body.achievements.map((a) => a.code)).toContain(railCode);
  });
});

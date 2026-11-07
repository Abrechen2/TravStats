import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The board sorted on points alone, over rows read in no particular order, and
 * numbered the result by position. Two users with the same points therefore got
 * ranks 1 and 2 in whatever order Postgres returned their rows, which can change
 * between two calls, and at the `limit` cut it decided which of them was shown.
 */
describe("achievement leaderboard ties", () => {
  const stamp = Date.now();
  // Created in reverse order, so row order alone would list "b" first.
  const names = [`ach-tie-b-${stamp}`, `ach-tie-a-${stamp}`, `ach-tie-c-${stamp}`];
  let cookie: string;
  let restorePoints: () => Promise<unknown>;

  beforeAll(async () => {
    const [first, second] = await prisma.achievement.findMany({
      where: { domain: "flight", code: { not: { startsWith: "TEST_" } } },
      orderBy: { code: "asc" },
      take: 2,
    });
    // b and a hold the same badge; c holds only the second one, scored to beat them.
    for (const [i, username] of names.entries()) {
      const user = await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      });
      cookie ??= `auth_token=${generateToken(user.id)}`;
      const held = i < 2 ? first : second;
      await prisma.userAchievement.create({
        data: {
          userId: user.id,
          achievementId: held.id,
          progress: held.requirement,
          unlockedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
    }
    restorePoints = () =>
      prisma.achievement.update({ where: { id: second.id }, data: { points: second.points } });
    await prisma.achievement.update({
      where: { id: second.id },
      data: { points: first.points + second.points + 1_000_000 },
    });
  });

  afterAll(async () => {
    await restorePoints();
    await prisma.user.deleteMany({ where: { username: { in: names } } });
  });

  it("gives equal points the same rank, in a stable order", async () => {
    const res = await request(app)
      .get("/api/v1/achievements/leaderboard")
      .query({ limit: 100 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ours = (res.body.leaderboard as { username: string; rank: number }[]).filter((e) =>
      names.includes(e.username)
    );
    const [c, a, b] = ours;
    expect(ours.map((e) => e.username)).toEqual([names[2], names[1], names[0]]);
    expect(a.rank).toBe(b.rank);
    expect(a.rank).toBeGreaterThan(c.rank);
  });
});

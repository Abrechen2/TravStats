import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { ensureAchievements } from "../../data/achievements";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * A rail badge follows a rail write on its own. The rail router never calls
 * the achievement engine itself; without the after-write recheck mounted over
 * `/api/v1/rail`, "Einsteigen, bitte" would wait for the next flight, stay or
 * place save.
 */

describe("rail badges after a rail write", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: "railrecheck" } });
    const user = await prisma.user.create({
      data: { username: "railrecheck", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
    await prisma.user.deleteMany({ where: { username: "railrecheck" } });
  });

  it("unlocks the first-ride badge once a past ride is logged", async () => {
    const first = await prisma.achievement.findUniqueOrThrow({ where: { code: "RAIL_FIRST" } });
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        trainCategory: "ICE",
        trainNumber: "597",
        departureStation: {
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: { name: "München Hbf", lat: 48.1403, lon: 11.5583, country: "DE" },
        departureLocal: "2024-04-02T08:15",
        arrivalLocal: "2024-04-02T11:40",
      });
    expect(res.status).toBe(201);

    // The check runs after the answer, so the badge arrives a moment later.
    let unlocked = false;
    for (let i = 0; i < 40 && !unlocked; i++) {
      const row = await prisma.userAchievement.findFirst({
        where: { userId, achievementId: first.id, unlockedAt: { not: null } },
      });
      unlocked = row !== null;
      if (!unlocked) await new Promise((r) => setTimeout(r, 100));
    }
    expect(unlocked).toBe(true);
  });
});

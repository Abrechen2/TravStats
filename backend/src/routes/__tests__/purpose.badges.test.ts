import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ensureAchievements } from "../../data/achievements";
import { isAchievementHeld } from "../../utils/achievementHeld";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** A hidden entry neither earns nor counts toward a badge, and a change of the setting re-derives them. */
describe("purpose: badges honour what the account hid", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const rail = (purpose: string) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Frankfurt (Main) Hbf",
        depLat: 50.1071,
        depLon: 8.6632,
        arrStationName: "München Hbf",
        arrLat: 48.1403,
        arrLon: 11.5583,
        departureTime: new Date("2024-04-02T08:15:00Z"),
        arrivalTime: new Date("2024-04-02T11:40:00Z"),
        status: "completed",
        purpose,
      },
    });
  const firstRideHeld = async (): Promise<boolean> => {
    const badge = await prisma.achievement.findUniqueOrThrow({ where: { code: "RAIL_FIRST" } });
    const row = await prisma.userAchievement.findFirst({
      where: { userId, achievementId: badge.id },
    });
    return isAchievementHeld(row, badge.requirement);
  };

  beforeAll(async () => {
    await ensureAchievements();
    userId = (
      await prisma.user.create({
        data: { username: `purpose-badge-${stamp}`, passwordHash: await hashPassword("x") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("revokes a badge earned only by a business ride once business rail is hidden, and restores it", async () => {
    await rail("business");
    await request(app).post("/api/v1/achievements/check").set("Cookie", cookie).expect(200);
    expect(await firstRideHeld()).toBe(true);

    await request(app)
      .put("/api/v1/purpose/visibility")
      .set("Cookie", cookie)
      .send({ rail: ["business"] })
      .expect(200);
    expect(await firstRideHeld()).toBe(false);

    await request(app).put("/api/v1/purpose/visibility").set("Cookie", cookie).send({}).expect(200);
    expect(await firstRideHeld()).toBe(true);
  });
});

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#385 (RULE-31): `limit` was parsed by hand with no lower bound, so
 * `?limit=-1` sliced off the LAST row instead of bounding the list.
 */
describe("achievements ?limit", () => {
  let userId: string;
  let cookie: string;
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `ach-limit-${Date.now()}`, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it.each(["/recent", "/leaderboard"])("%s rejects limit below 1 and non-integers", async (path) => {
    for (const bad of ["-1", "0", "abc", "2.5", "101"]) {
      const res = await request(app)
        .get(`/api/v1/achievements${path}`)
        .query({ limit: bad })
        .set("Cookie", cookie);
      expect(res.status).toBe(400);
    }
  });

  it.each(["/recent", "/leaderboard"])("%s accepts a valid and an absent limit", async (path) => {
    for (const q of [{}, { limit: "5" }, { limit: "100" }]) {
      const res = await request(app).get(`/api/v1/achievements${path}`).query(q).set("Cookie", cookie);
      expect(res.status).toBe(200);
    }
  });
});

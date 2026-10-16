import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Bulk edit shared `batchCreationLimiter` with the flight batch import, so a
 * few rounds of re-tagging a selection spent the hourly import budget and the
 * next email import was refused with a 429 for an act it had not performed.
 */
describe("POST /flights/bulk-edit — rate limit bucket", () => {
  const USERNAME = `flbulkbucket${Date.now()}`;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const remaining = (res: request.Response): number => Number(res.headers["ratelimit-remaining"]);

  it("does not spend the import bucket", async () => {
    // An empty batch is refused by validation, AFTER the limiter has counted it.
    const before = remaining(
      await request(app).post("/api/v1/flights/batch").set("Cookie", cookie).send([])
    );
    expect(Number.isFinite(before)).toBe(true);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post("/api/v1/flights/bulk-edit")
        .set("Cookie", cookie)
        .send({ flightIds: [] });
    }

    const after = remaining(
      await request(app).post("/api/v1/flights/batch").set("Cookie", cookie).send([])
    );
    expect(after).toBe(before - 1);
  });
});

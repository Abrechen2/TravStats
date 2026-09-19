import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Finding 6 of the cold security audit of 2026-09-19: `/evidence/:kind/:key`
 * carried no route limiter, while every other endpoint that scans the caller's
 * whole set to attribute one number carries `statsLimiter`. The caller's
 * `limit`/`offset` page the ANSWER, not the work, so a loop over the panel is
 * unbounded database work per request — and the only thing in front of it was
 * the global `/api` cap, which was itself skipping every private source
 * address until finding 5 was closed in the same change. The two compound,
 * which is why neither was left for later.
 *
 * In its own file, like `lodgingFxPreviewRateLimit.test.ts`: it deliberately
 * exhausts its user's window, and a fresh module registry per test file keeps
 * the in-memory store away from the other evidence suites.
 */
describe("GET /api/v1/evidence/:kind/:key — rate limiting", () => {
  let authCookie: string;
  let userId: string;

  // `statsLimiter`'s configured max — RATE_LIMITS.STATS_MAX_REQUESTS.
  const LIMIT = 30;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceratelimit" } });
    const user = await prisma.user.create({
      data: { username: "evidenceratelimit", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("allows up to the configured ceiling, then answers 429 in the same window", async () => {
    // A key the dispatcher answers 404 for: the limiter counts the REQUEST, so
    // this needs no seeded data and stays honest about what it measures.
    const url = "/api/v1/evidence/ranking/airline:ZZZZ";
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).get(url).set("Cookie", authCookie);
      expect(res.status).not.toBe(429);
    }

    const blocked = await request(app).get(url).set("Cookie", authCookie);
    expect(blocked.status).toBe(429);
  }, 60000);

  it("counts per user, so one caller cannot lock the panel for another", async () => {
    // The user above is exhausted. A different account on the same source
    // address still gets an answer — `statsLimiter` keys on `userOrIpKey`.
    const other = await prisma.user.create({
      data: { username: "evidenceratelimit2", passwordHash: await hashPassword("password123") },
    });
    try {
      const res = await request(app)
        .get("/api/v1/evidence/ranking/airline:ZZZZ")
        .set("Cookie", `auth_token=${generateToken(other.id)}`);
      expect(res.status).not.toBe(429);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});

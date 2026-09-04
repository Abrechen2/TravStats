import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#68 — `analyticsLimiter` sits behind `authenticate` but had no key
 * generator, so express-rate-limit keyed it by address. A household, or every
 * user behind one reverse proxy, shared a single bucket: one person's hundred
 * events blocked everyone else on the same connection.
 *
 * Own file on purpose: it exhausts the window for its first user, and each
 * Jest file gets a fresh module registry, so the in-memory store here is
 * isolated from every other test (see lodgingFxPreviewRateLimit.test.ts).
 */
describe("POST /api/v1/analytics/events — the bucket is per user, not per address", () => {
  // Must match analyticsLimiter's `max` in middleware/rateLimit.ts.
  const LIMIT = 100;
  const ids: string[] = [];
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["analytics-rl-a", "analytics-rl-b"] } } });
    for (const name of ["analytics-rl-a", "analytics-rl-b"]) {
      const u = await prisma.user.create({
        data: { username: name, passwordHash: await hashPassword("password123") },
      });
      ids.push(u.id);
    }
    cookieA = `auth_token=${generateToken(ids[0])}`;
    cookieB = `auth_token=${generateToken(ids[1])}`;
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("allows up to the ceiling for one user, then 429 — and a second user on the same address is not blocked", async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app)
        .post("/api/v1/analytics/events")
        .set("Cookie", cookieA)
        .send({ type: "parser_feedback" });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/v1/analytics/events")
      .set("Cookie", cookieA)
      .send({ type: "parser_feedback" });
    expect(blocked.status).toBe(429);

    // Same supertest client, same 127.0.0.1 — only the user differs.
    const other = await request(app)
      .post("/api/v1/analytics/events")
      .set("Cookie", cookieB)
      .send({ type: "parser_feedback" });
    expect(other.status).toBe(201);
  }, 60_000);
});

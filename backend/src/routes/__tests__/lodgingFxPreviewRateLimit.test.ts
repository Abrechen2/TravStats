import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/frankfurter";

/**
 * GET /api/v1/lodging/fx-preview proxies to the free public Frankfurter/ECB
 * API. `fx.convertToBase` caches per (from, to, date), so repeated identical
 * queries are free — but a caller can vary `date` to force unlimited
 * uncached outbound calls, risking an IP ban from the free upstream. This
 * route MUST be guarded by a dedicated per-user rate limiter, mirroring
 * `portGeocodeLimiter` (see middleware/rateLimit.ts).
 *
 * Kept in its own file (rather than folded into lodging.test.ts) because it
 * deliberately exhausts the limiter's window for its test user — that must
 * not bleed into the many other fx-preview assertions in lodging.test.ts.
 * Each Jest test file gets a fresh module registry (a fresh `app` import),
 * so the in-memory rate-limit store here is isolated from every other test
 * file even though `jest.config.js` runs with `maxWorkers: 1`.
 */
describe("GET /api/v1/lodging/fx-preview — rate limiting", () => {
  let authCookie: string;
  let userId: string;

  // Must match fxPreviewLimiter's configured `max` in middleware/rateLimit.ts
  // (mirrors portGeocodeLimiter's 30/min ceiling).
  const LIMIT = 30;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "lodgingfxratelimit" } });
    const u = await prisma.user.create({
      data: { username: "lodgingfxratelimit", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    // Avoid any real outbound network call to Frankfurter during this test —
    // only the rate limiter's own bookkeeping is under test here.
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 100,
      rate: 1,
      rateDate: "2026-01-01",
    });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it(
    "allows up to the configured ceiling, then returns 429 for the next request in the same window",
    async () => {
      for (let i = 0; i < LIMIT; i++) {
        const res = await request(app)
          .get("/api/v1/lodging/fx-preview")
          .query({ amount: 100, from: "USD", date: "2026-01-01" })
          .set("Cookie", authCookie);
        expect(res.status).toBe(200);
      }

      const blocked = await request(app)
        .get("/api/v1/lodging/fx-preview")
        .query({ amount: 100, from: "USD", date: "2026-01-01" })
        .set("Cookie", authCookie);
      expect(blocked.status).toBe(429);
    },
    30000
  );

  it("does not rate-limit unrelated lodging CRUD routes for the same user", async () => {
    // The limiter above already exhausted this user's fx-preview quota. A
    // completely unrelated route (the plain list endpoint) must be
    // unaffected — the limiter is scoped to /fx-preview only.
    const res = await request(app).get("/api/v1/lodging").set("Cookie", authCookie);
    expect(res.status).toBe(200);
  });
});

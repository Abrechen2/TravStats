import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * POST /api/v1/photo-journeys/scan is the most expensive request this app
 * accepts. One call reads the caller's whole Immich library across a ten-year
 * default window and reverse-geocodes the surviving clusters against
 * Nominatim, capped at `MAX_LOOKUPS` (40) — and since Nominatim throttles to
 * 1 req/s, forty seconds is the scan's FLOOR. Neither the library size nor the
 * upstream's patience is under this process's control, so the only thing it
 * can bound is how often a scan may start. This route MUST therefore be
 * guarded by `immichImportLimiter`, which it shares with the album import (see
 * middleware/rateLimit.ts).
 *
 * Kept in its own file, like `lodgingFxPreviewRateLimit.test.ts`, because it
 * deliberately exhausts the limiter's window for its test user — that must not
 * bleed into other assertions about the same routes. Each Jest test file gets
 * a fresh module registry (a fresh `app` import), so the in-memory rate-limit
 * store here is isolated from every other file even under `maxWorkers: 1`.
 */
describe("POST /api/v1/photo-journeys/scan — rate limiting", () => {
  let authCookie: string;
  let userId: string;

  // Must match immichImportLimiter's configured `max`
  // (RATE_LIMITS.IMMICH_IMPORT_MAX in config/constants.ts).
  const LIMIT = 20;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "photojourneyratelimit" } });
    const u = await prisma.user.create({
      data: {
        username: "photojourneyratelimit",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await prisma.photoJourney.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("allows up to the configured ceiling, then returns 429 for the next request in the same window", async () => {
    // No mock is needed and none is wanted: this user has no Immich
    // connection, so `scanPhotoJourneys` short-circuits to `no-immich`
    // before it opens a socket. A 200 here therefore proves the request
    // reached the handler, without any outbound call — which is the only
    // thing under test.
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app)
        .post("/api/v1/photo-journeys/scan")
        .send({})
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ scanned: false, reason: "immich-not-configured" });
    }

    const blocked = await request(app)
      .post("/api/v1/photo-journeys/scan")
      .send({})
      .set("Cookie", authCookie);
    expect(blocked.status).toBe(429);
  }, 30000);

  it("does not rate-limit the list route for the same user", async () => {
    // The scan quota is exhausted by the test above. Listing already-found
    // journeys is a single indexed read and is deliberately unlimited — the
    // limiter must be scoped to /scan alone, not to the router.
    const res = await request(app).get("/api/v1/photo-journeys").set("Cookie", authCookie);
    expect(res.status).toBe(200);
  });
});

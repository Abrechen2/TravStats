import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Security review of forgejo#265: a badge proof folds the badge's rows many
 * times over, so its key carries a tighter bucket than the evidence router's
 * `statsLimiter` — per user, like every limiter here. Its own file: it
 * exhausts its user's window.
 */
describe("GET /api/v1/evidence/metric/badge… — rate limiting", () => {
  let cookie: string;
  let userId: string;
  // RATE_LIMITS.BADGE_EVIDENCE_MAX_REQUESTS.
  const LIMIT = 10;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "badgeevidencelimit" } });
    userId = (
      await prisma.user.create({
        data: { username: "badgeevidencelimit", passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers 429 after the badge bucket, while other metrics still answer", async () => {
    const url = "/api/v1/evidence/metric/badgeNightFlights";
    for (let i = 0; i < LIMIT; i++) {
      expect((await request(app).get(url).set("Cookie", cookie)).status).toBe(200);
    }
    expect((await request(app).get(url).set("Cookie", cookie)).status).toBe(429);
    // The bucket is the badge proofs', not the whole panel's.
    expect(
      (await request(app).get("/api/v1/evidence/metric/flightCount").set("Cookie", cookie)).status
    ).toBe(200);
  }, 60_000);
});

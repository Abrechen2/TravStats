import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * Acceptance 2026-09-26: with the zone lookup broken (tsx loaded an empty
 * module), a rail journey typed as 08:15 in Frankfurt was stored as 08:15Z
 * with no zone, and the DST check never ran — the write "succeeded". A broken
 * lookup must refuse the write with a code, never store the wall clock as UTC.
 */
jest.mock("geo-tz/dist/find-all", () => ({ find: undefined }));

describe("rail write when the time zone lookup is broken", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "railtzbroken" } });
    const user = await prisma.user.create({
      data: { username: "railtzbroken", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers 503 TIMEZONE_LOOKUP_UNAVAILABLE and stores nothing", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        operator: "ÖBB",
        trainNumber: "RJX 62",
        departureStation: {
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" },
        departureLocal: "2026-07-01T08:15",
        arrivalLocal: "2026-07-01T12:09",
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("TIMEZONE_LOOKUP_UNAVAILABLE");
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });
});

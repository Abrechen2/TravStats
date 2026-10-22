import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railLookupLimiter } from "../../middleware/rateLimit";

/**
 * POST /rail/share-link/connection — the bookmarklet's hand-over (forgejo#204).
 * The body comes from a page the server does not control, so it is bounded,
 * read by the connection reader, and never stored.
 */
const RECON =
  "¶HKI¶T$A=1@O=Augsburg Hbf@L=8000013@a=128@$A=1@O=München Hbf@L=8000261@a=128@" +
  "$202611030808$202611030854$RB 57099$$1$$$$$$¶KC¶";

describe("POST /api/v1/rail/share-link/connection", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "railbahnhandoff" } });
    const user = await prisma.user.create({
      data: { username: "railbahnhandoff", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await railLookupLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers the ride for the review and stores nothing", async () => {
    const res = await request(app)
      .post("/api/v1/rail/share-link/connection")
      .set("Cookie", cookie)
      .send({ answer: { hinfahrtRecon: RECON } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outcome).toBe("read");
    expect(res.body.data.booking.legs[0]).toMatchObject({
      depStationName: "Augsburg Hbf",
      trainCategory: "RB",
      trainNumber: "57099",
    });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("names a tampered answer as unreadable, not as a server error", async () => {
    const res = await request(app)
      .post("/api/v1/rail/share-link/connection")
      .set("Cookie", cookie)
      .send({ answer: { hinfahrtRecon: "<script>alert(1)</script>" } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ outcome: "failed", reason: "unreadable" });
  });

  it("refuses an answer past its bounds", async () => {
    const res = await request(app)
      .post("/api/v1/rail/share-link/connection")
      .set("Cookie", cookie)
      .send({ answer: { hinfahrtRecon: "¶HKI¶" + "x".repeat(20_001) } });
    expect(res.status).toBe(400);
  });

  it("is not open without a session", async () => {
    const res = await request(app)
      .post("/api/v1/rail/share-link/connection")
      .send({ answer: { hinfahrtRecon: RECON } });
    expect(res.status).toBe(401);
  });
});

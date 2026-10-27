import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The account's TravPlan switch on `/settings` (owner, 2026-10-27): switched on
 * and off like a domain. Off by default, stored in its column, and switching it
 * off never touches a plan — that is the planning router's gate, tested in
 * `travplanBetaGate.integration.test.ts`.
 */
describe("settings — TravPlan per account", () => {
  const username = `travplan-switch-${Date.now()}`;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("GET answers off for a new account, like every domain but flights", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.travPlan).toEqual({ enabled: false });
  });

  it("PUT stores it in its column, echoes it, and leaves domains and the blob alone", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ enabledDomains: ["flight", "lodging"] })
      .expect(200);
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ travPlan: { enabled: true } })
      .expect(200);
    expect(put.body.travPlan).toEqual({ enabled: true });
    expect(put.body.enabledDomains).toEqual(["flight", "lodging"]);
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.travPlanEnabled).toBe(true);
    expect(row.data).not.toHaveProperty("travPlan");

    const off = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ travPlan: { enabled: false } })
      .expect(200);
    expect(off.body.travPlan).toEqual({ enabled: false });
  });

  it("refuses a value that is not a boolean", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ travPlan: { enabled: "yes" } })
      .expect(400);
  });
});

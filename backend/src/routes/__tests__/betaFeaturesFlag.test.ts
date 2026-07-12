import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The instance-level beta gate (AdminSettings.betaFeaturesEnabled).
 *
 * Two properties matter and are pinned here:
 *   1. Only an admin can WRITE it — through PUT /admin/instance-settings.
 *      A normal user must not be able to smuggle it in via PUT /settings,
 *      which is the endpoint they *can* reach.
 *   2. Every logged-in user can READ it from GET /settings, so the frontend
 *      learns the value at boot without a second request.
 */
describe("Beta features flag", () => {
  let userId: string;
  let adminId: string;
  let userCookie: string;
  let adminCookie: string;
  /** Restored in afterAll so the suite doesn't leave the dev instance flagged. */
  let originalFlag = false;
  let originalInstanceName: string | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["beta_flag_user", "beta_flag_admin"] } },
    });
    const user = await prisma.user.create({
      data: { username: "beta_flag_user", passwordHash: await hashPassword("password123") },
    });
    const admin = await prisma.user.create({
      data: {
        username: "beta_flag_admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    userId = user.id;
    adminId = admin.id;
    userCookie = `auth_token=${generateToken(user.id)}`;
    adminCookie = `auth_token=${generateToken(admin.id)}`;

    const row = await prisma.adminSettings.findFirst();
    originalFlag = row?.betaFeaturesEnabled ?? false;
    originalInstanceName = row?.instanceName ?? null;
  });

  afterAll(async () => {
    const row = await prisma.adminSettings.findFirst();
    if (row) {
      await prisma.adminSettings.update({
        where: { id: row.id },
        data: { betaFeaturesEnabled: originalFlag, instanceName: originalInstanceName },
      });
    }
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
  });

  /** Set the flag directly, bypassing the API — arranges a known state. */
  async function setFlag(value: boolean): Promise<void> {
    const row = await prisma.adminSettings.findFirst();
    if (row) {
      await prisma.adminSettings.update({
        where: { id: row.id },
        data: { betaFeaturesEnabled: value },
      });
    } else {
      await prisma.adminSettings.create({ data: { betaFeaturesEnabled: value } });
    }
  }

  describe("read path — GET /api/v1/settings", () => {
    it("exposes the flag to a normal user (false)", async () => {
      await setFlag(false);
      const res = await request(app).get("/api/v1/settings").set("Cookie", userCookie);
      expect(res.status).toBe(200);
      expect(res.body.betaFeaturesEnabled).toBe(false);
    });

    it("exposes the flag to a normal user (true)", async () => {
      await setFlag(true);
      const res = await request(app).get("/api/v1/settings").set("Cookie", userCookie);
      expect(res.status).toBe(200);
      expect(res.body.betaFeaturesEnabled).toBe(true);
    });
  });

  describe("write path — a user must NOT be able to set it", () => {
    it("ignores betaFeaturesEnabled sent through PUT /api/v1/settings", async () => {
      await setFlag(false);

      const res = await request(app)
        .put("/api/v1/settings")
        .set("Cookie", userCookie)
        .send({ betaFeaturesEnabled: true, display: { theme: "dark" } });

      // The request itself succeeds — the unknown key is simply stripped by
      // Zod — but the flag must not have moved.
      expect(res.status).toBe(200);
      expect(res.body.betaFeaturesEnabled).toBe(false);

      const row = await prisma.adminSettings.findFirst();
      expect(row?.betaFeaturesEnabled).toBe(false);

      // ...and it must not have been smuggled into the user's settings JSON,
      // where it could later shadow the real value.
      const stored = await prisma.userSettings.findUnique({ where: { userId } });
      const data = stored?.data as Record<string, unknown> | null;
      expect(data?.betaFeaturesEnabled).toBeUndefined();
    });

    it("rejects a non-admin on the admin instance-settings route", async () => {
      await setFlag(false);
      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", userCookie)
        .send({ betaFeaturesEnabled: true });

      expect(res.status).toBe(403);
      const row = await prisma.adminSettings.findFirst();
      expect(row?.betaFeaturesEnabled).toBe(false);
    });
  });

  describe("write path — an admin CAN set it", () => {
    it("turns the flag on via PUT /api/v1/admin/instance-settings", async () => {
      await setFlag(false);

      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ betaFeaturesEnabled: true });

      expect(res.status).toBe(200);
      expect(res.body.settings.betaFeaturesEnabled).toBe(true);

      const row = await prisma.adminSettings.findFirst();
      expect(row?.betaFeaturesEnabled).toBe(true);

      // …and a normal user immediately sees it.
      const asUser = await request(app).get("/api/v1/settings").set("Cookie", userCookie);
      expect(asUser.body.betaFeaturesEnabled).toBe(true);
    });

    it("turns the flag back off", async () => {
      await setFlag(true);

      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ betaFeaturesEnabled: false });

      expect(res.status).toBe(200);
      expect(res.body.settings.betaFeaturesEnabled).toBe(false);
    });

    it("rejects a non-boolean value", async () => {
      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ betaFeaturesEnabled: "yes" });

      expect(res.status).toBe(400);
    });

    it("leaves the flag untouched when the PATCH is about something else", async () => {
      await setFlag(true);

      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ instanceName: "Beta Flag Test Instance" });

      expect(res.status).toBe(200);
      expect(res.body.settings.betaFeaturesEnabled).toBe(true);
    });
  });
});

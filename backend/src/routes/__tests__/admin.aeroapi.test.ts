import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";

/** The admin's AeroAPI plan, budget and track switch (forgejo#409). */
describe("/admin/aeroapi", () => {
  let adminCookie: string;
  let userCookie: string;
  let adminId: string;
  let userId: string;
  let saved: {
    aeroapiTier: string;
    aeroapiCustomBudgetUsd: number | null;
    aeroapiTracksEnabled: boolean;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const admin = await prisma.user.create({
      data: {
        username: `aeroapi-admin-${stamp}`,
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: `aeroapi-user-${stamp}`, passwordHash: await hashPassword("password123") },
    });
    adminId = admin.id;
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
    const row = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: await ensureAdminSettingsRow() },
    });
    saved = {
      aeroapiTier: row.aeroapiTier,
      aeroapiCustomBudgetUsd: row.aeroapiCustomBudgetUsd,
      aeroapiTracksEnabled: row.aeroapiTracksEnabled,
    };
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: saved,
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await prisma.$disconnect();
  });

  it("starts on the personal tier with tracks off", async () => {
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { aeroapiTier: "personal", aeroapiCustomBudgetUsd: null, aeroapiTracksEnabled: false },
    });

    const res = await request(app).get("/api/v1/admin/aeroapi").set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("personal");
    expect(res.body.tracksEnabled).toBe(false);
    expect(res.body.usage).toMatchObject({ budgetUsd: 5, spentUsd: expect.any(Number) });
  });

  it("switches to the feeder tier ($10), a custom budget and the tracks switch", async () => {
    const feeder = await request(app)
      .put("/api/v1/admin/aeroapi")
      .set("Cookie", adminCookie)
      .send({ tier: "personal_feeder", tracksEnabled: true });
    expect(feeder.status).toBe(200);
    expect(feeder.body.usage.budgetUsd).toBe(10);
    expect(feeder.body.tracksEnabled).toBe(true);

    const custom = await request(app)
      .put("/api/v1/admin/aeroapi")
      .set("Cookie", adminCookie)
      .send({ tier: "custom", customBudgetUsd: 25.5 });
    expect(custom.body.usage.budgetUsd).toBe(25.5);
    expect(custom.body.customBudgetUsd).toBe(25.5);
  });

  it("refuses a custom tier without a budget, naming the field", async () => {
    const res = await request(app)
      .put("/api/v1/admin/aeroapi")
      .set("Cookie", adminCookie)
      .send({ tier: "custom", customBudgetUsd: null });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AEROAPI_BUDGET_REQUIRED");
    expect(res.body.field).toBe("customBudgetUsd");
  });

  it("refuses an unknown tier and a non-admin", async () => {
    const bad = await request(app)
      .put("/api/v1/admin/aeroapi")
      .set("Cookie", adminCookie)
      .send({ tier: "enterprise" });
    expect(bad.status).toBe(400);

    const denied = await request(app).get("/api/v1/admin/aeroapi").set("Cookie", userCookie);
    expect(denied.status).toBe(403);
  });
});

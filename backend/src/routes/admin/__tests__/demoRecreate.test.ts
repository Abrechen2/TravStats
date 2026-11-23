import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

const seedDemoInstance = jest.fn(async () => ({ userId: "x", counts: {} }));
jest.mock("../../../seedDemoAccount", () => ({ seedDemoInstance }));

import app from "../../../index";
import { prisma } from "../../../db";
import { demoSeedAllowed, markDemoRemoved } from "../../../services/demoAccount";
import { settleAllJobs } from "../../../services/jobs/jobRegistry";
import { generateToken } from "../../../utils/jwt";

describe("POST /admin/demo/recreate (Demo-Konto wieder anlegen)", () => {
  let admin: { id: string };
  beforeAll(async () => {
    admin = await prisma.user.create({
      data: { username: `demo-recreate-admin-${Date.now()}`, passwordHash: "x", isAdmin: true },
    });
  });
  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { demoRemovedAt: null } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it("clears the removal marker and seeds the account explicitly", async () => {
    await markDemoRemoved();
    delete process.env.CREATE_DEMO_USER;
    expect(await demoSeedAllowed()).toBe(false);

    const res = await request(app)
      .post("/api/v1/admin/demo/recreate")
      .set("Cookie", `auth_token=${generateToken(admin.id)}`);
    expect(res.status).toBe(202);
    await settleAllJobs();
    expect(seedDemoInstance).toHaveBeenCalledTimes(1);
    expect(await demoSeedAllowed()).toBe(true);
  });

  it("refuses to re-create while a demo account exists (the seed would wipe it)", async () => {
    await prisma.user.create({ data: { username: "demo", passwordHash: "x", isDemo: true } });
    const before = seedDemoInstance.mock.calls.length;
    const res = await request(app)
      .post("/api/v1/admin/demo/recreate")
      .set("Cookie", `auth_token=${generateToken(admin.id)}`);
    await prisma.user.deleteMany({ where: { username: "demo" } });
    expect(res.status).toBe(409);
    expect(seedDemoInstance.mock.calls.length).toBe(before);
  });

  it("is admin-only", async () => {
    const user = await prisma.user.create({
      data: { username: `demo-recreate-user-${Date.now()}`, passwordHash: "x" },
    });
    const res = await request(app)
      .post("/api/v1/admin/demo/recreate")
      .set("Cookie", `auth_token=${generateToken(user.id)}`);
    expect(res.status).toBe(403);
    await prisma.user.delete({ where: { id: user.id } });
  });
});

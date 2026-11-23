import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { bootSeedDemo } from "../../../seedDemoAccount";
import { demoSeedAllowed, getDemoRemovedAt } from "../../../services/demoAccount";
import { generateToken } from "../../../utils/jwt";

/**
 * An admin's deletion of the demo account is final: with CREATE_DEMO_USER=true
 * in the compose, every boot used to seed it again and the delete undid itself.
 */
describe("deleting the demo account is final across boots", () => {
  let admin: { id: string };
  const cookie = () => `auth_token=${generateToken(admin.id)}`;
  const envBefore = process.env.CREATE_DEMO_USER;
  const dropDemo = () => prisma.user.deleteMany({ where: { username: "demo" } });

  beforeAll(async () => {
    admin = await prisma.user.create({
      data: { username: `demo-removal-admin-${Date.now()}`, passwordHash: "unused", isAdmin: true },
    });
  });
  beforeEach(async () => {
    await dropDemo();
    await prisma.adminSettings.updateMany({ data: { demoRemovedAt: null } });
    delete process.env.CREATE_DEMO_USER;
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env.CREATE_DEMO_USER;
    else process.env.CREATE_DEMO_USER = envBefore;
  });
  afterAll(async () => {
    await dropDemo();
    await prisma.adminSettings.updateMany({ data: { demoRemovedAt: null } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

  const makeDemo = () =>
    prisma.user.create({
      data: { username: "demo", passwordHash: "unused", isDemo: true },
    });

  it("records the removal and the boot seed then leaves the account deleted", async () => {
    const demo = await makeDemo();
    const res = await request(app).delete(`/api/v1/admin/users/${demo.id}`).set("Cookie", cookie());
    expect(res.status).toBe(200);
    expect(await getDemoRemovedAt()).toBeInstanceOf(Date);

    expect(await demoSeedAllowed()).toBe(false);
    expect(await bootSeedDemo()).toBeNull();
    expect(await prisma.user.findUnique({ where: { username: "demo" } })).toBeNull();
  });

  it("does not record a removal when an ordinary account is deleted", async () => {
    const other = await prisma.user.create({
      data: { username: `plain-${Date.now()}`, passwordHash: "x" },
    });
    await request(app).delete(`/api/v1/admin/users/${other.id}`).set("Cookie", cookie());
    expect(await getDemoRemovedAt()).toBeNull();
    expect(await demoSeedAllowed()).toBe(true);
  });

  it("lets the operator's explicit CREATE_DEMO_USER=true seed anyway, and says so in system info", async () => {
    const demo = await makeDemo();
    await request(app).delete(`/api/v1/admin/users/${demo.id}`).set("Cookie", cookie());
    process.env.CREATE_DEMO_USER = "true";
    expect(await demoSeedAllowed()).toBe(true);

    const info = await request(app).get("/api/v1/admin/system/info").set("Cookie", cookie());
    expect(info.body.demoForcedByEnv).toBe(true);
    expect(info.body.demoRemovedAt).not.toBeNull();
  });
});

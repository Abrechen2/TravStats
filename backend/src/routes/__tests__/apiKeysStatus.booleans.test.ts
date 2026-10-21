import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";

/**
 * `GET/PUT /api/v1/settings/api-keys` answer every user with flags about the
 * instance's keys. The OpenSky flags were built as `hasUser || hasGlobal || …`
 * over the stored columns, so the answer carried the stored (encrypted) client
 * id itself instead of `true` — to every account on the instance (beta.22 UAT).
 */
describe("settings/api-keys status answers only booleans", () => {
  let user: { id: string };
  let cookie: string;
  let saved: { globalOpenskyClientId: string | null; globalOpenskyUsername: string | null } | null =
    null;
  const STORED_GLOBAL = encryptApiKey("global-opensky-client-id")!;

  const flagsOf = (body: Record<string, unknown>): unknown[] =>
    Object.values(body).flatMap((v) => Object.values(v as Record<string, unknown>));

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        username: `apikeys-bool-${Date.now()}`,
        passwordHash: await hashPassword("pw-123456"),
        isActive: true,
      },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (!admin) {
      await prisma.adminSettings.create({
        data: { allowUserApiKeys: true, allowUserFlightApiKeys: true },
      });
    }
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    saved = {
      globalOpenskyClientId: row!.globalOpenskyClientId,
      globalOpenskyUsername: row!.globalOpenskyUsername,
    };
  });

  afterEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: user.id } });
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: saved ?? {} });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  it("GET never carries the stored global OpenSky client id, only booleans", async () => {
    await prisma.adminSettings.updateMany({ data: { globalOpenskyClientId: STORED_GLOBAL } });
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(STORED_GLOBAL);
    for (const flag of flagsOf(res.body)) expect(typeof flag).toBe("boolean");
    expect(res.body.opensky).toEqual({ hasKey: false, isShared: true, hasAccess: true });
  });

  it("GET never carries the user's own stored OpenSky client id", async () => {
    const own = encryptApiKey("own-opensky-client-id")!;
    await prisma.userSettings.create({
      data: { userId: user.id, data: {}, openskyClientId: own },
    });
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(own);
    for (const flag of flagsOf(res.body)) expect(typeof flag).toBe("boolean");
  });

  it("PUT answers only booleans, also with no global OpenSky key stored", async () => {
    await prisma.adminSettings.updateMany({
      data: { globalOpenskyClientId: null, globalOpenskyUsername: null },
    });
    const res = await request(app)
      .put("/api/v1/settings/api-keys")
      .set("Cookie", cookie)
      .send({ graphhopperApiKey: "gh-key" });
    expect(res.status).toBe(200);
    for (const flag of flagsOf(res.body.apiKeys)) expect(typeof flag).toBe("boolean");
  });
});

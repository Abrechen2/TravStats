import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption";
import { getApiKey } from "../../services/apiKeyResolver";
import { projectAdminSettings } from "../../services/diagnostics/settingsAllowlist";

/**
 * FlightAware AeroAPI key plumbing: the per-user key (gated like every other
 * flight-data key by `allowUserFlightApiKeys`), the admin's global key (masked
 * on the way out, `encryptUnlessMasked` on the way in) and the resolver's
 * user > global > env order.
 */
describe("AeroAPI key settings", () => {
  let adminUser: { id: string };
  let adminCookie: string;
  let regularUser: { id: string };
  let regularCookie: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-aeroapi-settings-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;

    regularUser = await prisma.user.create({
      data: {
        username: `user-aeroapi-settings-${timestamp}`,
        passwordHash: await hashPassword("user-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    regularCookie = `auth_token=${generateToken(regularUser.id)}`;

    const existing = await prisma.adminSettings.findFirst();
    if (!existing) {
      await prisma.adminSettings.create({
        data: { allowUserApiKeys: true, allowUserFlightApiKeys: true },
      });
    }
  });

  afterEach(async () => {
    await prisma.adminSettings.updateMany({
      data: { globalAeroapiApiKey: null, allowUserFlightApiKeys: true },
    });
    await prisma.userSettings.updateMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
      data: { aeroapiApiKey: null },
    });
    delete process.env.AEROAPI_API_KEY;
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, regularUser.id] } } });
    await prisma.$disconnect();
  });

  describe("user key", () => {
    it("stores the key encrypted and reports it as the user's own", async () => {
      const put = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ aeroapiApiKey: "user-aeroapi-key-123456" });
      expect(put.status).toBe(200);
      expect(put.body.apiKeys.aeroapi).toMatchObject({ hasKey: true, isShared: false });

      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.aeroapiApiKey).not.toBe("user-aeroapi-key-123456");
      expect(decryptApiKey(row?.aeroapiApiKey ?? null)).toBe("user-aeroapi-key-123456");

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);
      expect(get.status).toBe(200);
      expect(get.body.aeroapi).toEqual({ hasKey: true, isShared: false, hasAccess: true });
      expect(JSON.stringify(get.body)).not.toContain("user-aeroapi-key-123456");
    });

    it("is refused with 403 when the admin disallows user flight keys", async () => {
      await prisma.adminSettings.updateMany({ data: { allowUserFlightApiKeys: false } });

      const put = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ aeroapiApiKey: "user-aeroapi-key-123456" });

      expect(put.status).toBe(403);
      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.aeroapiApiKey ?? null).toBeNull();
    });

    it("reports the admin's key as shared", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAeroapiApiKey: encryptApiKey("global-aeroapi-key-1234") },
      });

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);

      expect(get.body.aeroapi).toEqual({ hasKey: false, isShared: true, hasAccess: true });
    });
  });

  describe("admin global key", () => {
    it("masks the key in GET and keeps it when the mask is echoed back", async () => {
      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAeroapiApiKey: "global-aeroapi-key-1234" });
      expect(put.status).toBe(200);
      expect(put.body.settings.globalAeroapiApiKey).toContain("****");

      const get = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
      const masked = get.body.globalAeroapiApiKey as string;
      expect(masked).toContain("****");
      expect(masked).not.toBe("global-aeroapi-key-1234");

      const echo = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAeroapiApiKey: masked });
      expect(echo.status).toBe(200);

      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(decryptApiKey(row?.globalAeroapiApiKey ?? null)).toBe("global-aeroapi-key-1234");
    });

    it("clears the key on an empty string", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAeroapiApiKey: encryptApiKey("global-aeroapi-key-1234") },
      });

      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAeroapiApiKey: "" });

      expect(put.status).toBe(200);
      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(row?.globalAeroapiApiKey).toBeNull();
    });

    it("is listed as configured in the diagnostics allowlist, never as a value", async () => {
      const projected = projectAdminSettings({
        globalAeroapiApiKey: encryptApiKey("global-aeroapi-key-1234"),
      });

      expect(projected.aeroapiKeyConfigured).toBe(true);
      expect(JSON.stringify(projected)).not.toContain("global-aeroapi-key-1234");
    });
  });

  describe("resolver order", () => {
    it("prefers the user's key, then the admin's, then AEROAPI_API_KEY", async () => {
      process.env.AEROAPI_API_KEY = "env-aeroapi-key-123456";
      expect(await getApiKey("aeroapi", regularUser.id)).toBe("env-aeroapi-key-123456");

      await prisma.adminSettings.updateMany({
        data: { globalAeroapiApiKey: encryptApiKey("global-aeroapi-key-1234") },
      });
      expect(await getApiKey("aeroapi", regularUser.id)).toBe("global-aeroapi-key-1234");

      await prisma.userSettings.upsert({
        where: { userId: regularUser.id },
        update: { aeroapiApiKey: encryptApiKey("user-aeroapi-key-123456") },
        create: {
          userId: regularUser.id,
          data: {},
          aeroapiApiKey: encryptApiKey("user-aeroapi-key-123456"),
        },
      });
      expect(await getApiKey("aeroapi", regularUser.id)).toBe("user-aeroapi-key-123456");
    });
  });
});

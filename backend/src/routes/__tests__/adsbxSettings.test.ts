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
 * ADS-B Exchange key plumbing: the per-user key (gated like every other
 * flight-data key by `allowUserFlightApiKeys`), the admin's global key (masked
 * on the way out, `encryptUnlessMasked` on the way in) and the resolver's
 * user > global > env order.
 */
describe("ADS-B Exchange key settings", () => {
  let adminUser: { id: string };
  let adminCookie: string;
  let regularUser: { id: string };
  let regularCookie: string;
  /** The row's values before this suite, put back in afterAll. */
  let previousAdmin: { allowUserFlightApiKeys: boolean; globalAdsbxApiKey: string | null };
  const previousEnvKey = process.env.ADSBX_RAPIDAPI_KEY;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-adsbx-settings-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;

    regularUser = await prisma.user.create({
      data: {
        username: `user-adsbx-settings-${timestamp}`,
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
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    previousAdmin = {
      allowUserFlightApiKeys: row?.allowUserFlightApiKeys ?? true,
      globalAdsbxApiKey: row?.globalAdsbxApiKey ?? null,
    };
    await prisma.adminSettings.updateMany({
      data: { globalAdsbxApiKey: null, allowUserFlightApiKeys: true },
    });
    delete process.env.ADSBX_RAPIDAPI_KEY;
  });

  // Each test starts from "user keys allowed, no ADS-B Exchange key anywhere"; the
  // suite's own starting values come back in afterAll.
  afterEach(async () => {
    await prisma.adminSettings.updateMany({
      data: { globalAdsbxApiKey: null, allowUserFlightApiKeys: true },
    });
    await prisma.userSettings.updateMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
      data: { adsbxApiKey: null },
    });
    delete process.env.ADSBX_RAPIDAPI_KEY;
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: previousAdmin });
    if (previousEnvKey === undefined) delete process.env.ADSBX_RAPIDAPI_KEY;
    else process.env.ADSBX_RAPIDAPI_KEY = previousEnvKey;
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
        .send({ adsbxApiKey: "user-adsbx-key-123456" });
      expect(put.status).toBe(200);
      expect(put.body.apiKeys.adsbx).toMatchObject({ hasKey: true, isShared: false });

      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.adsbxApiKey).not.toBe("user-adsbx-key-123456");
      expect(decryptApiKey(row?.adsbxApiKey ?? null)).toBe("user-adsbx-key-123456");

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);
      expect(get.status).toBe(200);
      expect(get.body.adsbx).toEqual({ hasKey: true, isShared: false, hasAccess: true });
      expect(JSON.stringify(get.body)).not.toContain("user-adsbx-key-123456");
    });

    it("is refused with 403 when the admin disallows user flight keys", async () => {
      await prisma.adminSettings.updateMany({ data: { allowUserFlightApiKeys: false } });

      const put = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ adsbxApiKey: "user-adsbx-key-123456" });

      expect(put.status).toBe(403);
      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.adsbxApiKey ?? null).toBeNull();
    });

    it("reports the admin's key as shared", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAdsbxApiKey: encryptApiKey("global-adsbx-key-1234") },
      });

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);

      expect(get.body.adsbx).toEqual({ hasKey: false, isShared: true, hasAccess: true });
    });
  });

  describe("admin global key", () => {
    it("masks the key in GET and keeps it when the mask is echoed back", async () => {
      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsbxApiKey: "global-adsbx-key-1234" });
      expect(put.status).toBe(200);
      expect(put.body.settings.globalAdsbxApiKey).toContain("****");

      const get = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
      const masked = get.body.globalAdsbxApiKey as string;
      expect(masked).toContain("****");
      expect(masked).not.toBe("global-adsbx-key-1234");

      const echo = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsbxApiKey: masked });
      expect(echo.status).toBe(200);

      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(decryptApiKey(row?.globalAdsbxApiKey ?? null)).toBe("global-adsbx-key-1234");
    });

    it("clears the key on an empty string", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAdsbxApiKey: encryptApiKey("global-adsbx-key-1234") },
      });

      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsbxApiKey: "" });

      expect(put.status).toBe(200);
      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(row?.globalAdsbxApiKey).toBeNull();
    });

    it("is listed as configured in the diagnostics allowlist, never as a value", async () => {
      const projected = projectAdminSettings({
        globalAdsbxApiKey: encryptApiKey("global-adsbx-key-1234"),
      });

      expect(projected.adsbxKeyConfigured).toBe(true);
      expect(JSON.stringify(projected)).not.toContain("global-adsbx-key-1234");
    });
  });

  describe("resolver order", () => {
    it("prefers the user's key, then the admin's, and never ADSBX_RAPIDAPI_KEY", async () => {
      process.env.ADSBX_RAPIDAPI_KEY = "env-adsbx-key-123456";
      expect(await getApiKey("adsbx", regularUser.id)).toBeNull();

      await prisma.adminSettings.updateMany({
        data: { globalAdsbxApiKey: encryptApiKey("global-adsbx-key-1234") },
      });
      expect(await getApiKey("adsbx", regularUser.id)).toBe("global-adsbx-key-1234");

      await prisma.userSettings.upsert({
        where: { userId: regularUser.id },
        update: { adsbxApiKey: encryptApiKey("user-adsbx-key-123456") },
        create: {
          userId: regularUser.id,
          data: {},
          adsbxApiKey: encryptApiKey("user-adsbx-key-123456"),
        },
      });
      expect(await getApiKey("adsbx", regularUser.id)).toBe("user-adsbx-key-123456");
    });
  });
});

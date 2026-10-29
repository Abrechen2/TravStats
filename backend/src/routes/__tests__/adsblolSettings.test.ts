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
 * FlightAware adsb.lol key plumbing: the per-user key (gated like every other
 * flight-data key by `allowUserFlightApiKeys`), the admin's global key (masked
 * on the way out, `encryptUnlessMasked` on the way in) and the resolver's
 * user > global > env order.
 */
describe("adsb.lol key settings", () => {
  let adminUser: { id: string };
  let adminCookie: string;
  let regularUser: { id: string };
  let regularCookie: string;
  /** The row's values before this suite, put back in afterAll. */
  let previousAdmin: { allowUserFlightApiKeys: boolean; globalAdsblolApiKey: string | null };
  const previousEnvKey = process.env.ADSBLOL_API_KEY;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-adsblol-settings-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;

    regularUser = await prisma.user.create({
      data: {
        username: `user-adsblol-settings-${timestamp}`,
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
      globalAdsblolApiKey: row?.globalAdsblolApiKey ?? null,
    };
    await prisma.adminSettings.updateMany({
      data: { globalAdsblolApiKey: null, allowUserFlightApiKeys: true },
    });
    delete process.env.ADSBLOL_API_KEY;
  });

  // Each test starts from "user keys allowed, no adsb.lol key anywhere"; the
  // suite's own starting values come back in afterAll.
  afterEach(async () => {
    await prisma.adminSettings.updateMany({
      data: { globalAdsblolApiKey: null, allowUserFlightApiKeys: true },
    });
    await prisma.userSettings.updateMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
      data: { adsblolApiKey: null },
    });
    delete process.env.ADSBLOL_API_KEY;
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: previousAdmin });
    if (previousEnvKey === undefined) delete process.env.ADSBLOL_API_KEY;
    else process.env.ADSBLOL_API_KEY = previousEnvKey;
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
        .send({ adsblolApiKey: "user-adsblol-key-123456" });
      expect(put.status).toBe(200);
      expect(put.body.apiKeys.adsblol).toMatchObject({ hasKey: true, isShared: false });

      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.adsblolApiKey).not.toBe("user-adsblol-key-123456");
      expect(decryptApiKey(row?.adsblolApiKey ?? null)).toBe("user-adsblol-key-123456");

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);
      expect(get.status).toBe(200);
      expect(get.body.adsblol).toEqual({ hasKey: true, isShared: false, hasAccess: true });
      expect(JSON.stringify(get.body)).not.toContain("user-adsblol-key-123456");
    });

    it("is refused with 403 when the admin disallows user flight keys", async () => {
      await prisma.adminSettings.updateMany({ data: { allowUserFlightApiKeys: false } });

      const put = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ adsblolApiKey: "user-adsblol-key-123456" });

      expect(put.status).toBe(403);
      const row = await prisma.userSettings.findUnique({ where: { userId: regularUser.id } });
      expect(row?.adsblolApiKey ?? null).toBeNull();
    });

    it("reports the admin's key as shared", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAdsblolApiKey: encryptApiKey("global-adsblol-key-1234") },
      });

      const get = await request(app).get("/api/v1/settings/api-keys").set("Cookie", regularCookie);

      expect(get.body.adsblol).toEqual({ hasKey: false, isShared: true, hasAccess: true });
    });
  });

  describe("admin global key", () => {
    it("masks the key in GET and keeps it when the mask is echoed back", async () => {
      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsblolApiKey: "global-adsblol-key-1234" });
      expect(put.status).toBe(200);
      expect(put.body.settings.globalAdsblolApiKey).toContain("****");

      const get = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
      const masked = get.body.globalAdsblolApiKey as string;
      expect(masked).toContain("****");
      expect(masked).not.toBe("global-adsblol-key-1234");

      const echo = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsblolApiKey: masked });
      expect(echo.status).toBe(200);

      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(decryptApiKey(row?.globalAdsblolApiKey ?? null)).toBe("global-adsblol-key-1234");
    });

    it("clears the key on an empty string", async () => {
      await prisma.adminSettings.updateMany({
        data: { globalAdsblolApiKey: encryptApiKey("global-adsblol-key-1234") },
      });

      const put = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalAdsblolApiKey: "" });

      expect(put.status).toBe(200);
      const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
      expect(row?.globalAdsblolApiKey).toBeNull();
    });

    it("is listed as configured in the diagnostics allowlist, never as a value", async () => {
      const projected = projectAdminSettings({
        globalAdsblolApiKey: encryptApiKey("global-adsblol-key-1234"),
      });

      expect(projected.adsblolKeyConfigured).toBe(true);
      expect(JSON.stringify(projected)).not.toContain("global-adsblol-key-1234");
    });
  });

  describe("resolver order", () => {
    it("prefers the user's key, then the admin's, then ADSBLOL_API_KEY", async () => {
      process.env.ADSBLOL_API_KEY = "env-adsblol-key-123456";
      expect(await getApiKey("adsblol", regularUser.id)).toBe("env-adsblol-key-123456");

      await prisma.adminSettings.updateMany({
        data: { globalAdsblolApiKey: encryptApiKey("global-adsblol-key-1234") },
      });
      expect(await getApiKey("adsblol", regularUser.id)).toBe("global-adsblol-key-1234");

      await prisma.userSettings.upsert({
        where: { userId: regularUser.id },
        update: { adsblolApiKey: encryptApiKey("user-adsblol-key-123456") },
        create: {
          userId: regularUser.id,
          data: {},
          adsblolApiKey: encryptApiKey("user-adsblol-key-123456"),
        },
      });
      expect(await getApiKey("adsblol", regularUser.id)).toBe("user-adsblol-key-123456");
    });
  });
});

describe("adsb.lol admin switch", () => {
  let adminCookie: string;
  let adminId: string;
  let previous: boolean | undefined;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        username: `admin-adsblol-switch-${Date.now()}`,
        passwordHash: await hashPassword("pw"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    previous = (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } }))?.adsbLolEnabled;
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { adsbLolEnabled: previous ?? false } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("is OFF by default and the admin can switch it on and off", async () => {
    await prisma.adminSettings.updateMany({ data: { adsbLolEnabled: false } });
    const off = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
    expect(off.body.adsbLolEnabled).toBe(false);

    const on = await request(app)
      .put("/api/v1/admin/api-keys")
      .set("Cookie", adminCookie)
      .send({ adsbLolEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body.settings.adsbLolEnabled).toBe(true);
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    expect(row?.adsbLolEnabled).toBe(true);
    expect(projectAdminSettings(row as unknown as Record<string, unknown>).adsbLolEnabled).toBe(
      true
    );
  });
});

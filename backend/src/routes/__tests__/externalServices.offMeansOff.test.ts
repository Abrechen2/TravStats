import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import { railRoutingBaseUrl } from "../../services/rail/openRailRouting";
import { instanceServicesView } from "../../services/settings/instanceServices";
import {
  resolveAirlineLogo,
  __resetNegativeCacheForTests,
} from "../../services/airlineLogo/airlineLogoService";
import { answerOperatorMark } from "../../services/operatorLogos/operatorMarkService";
import { resolveRailLlmChain } from "../../services/rail/parser/railLlmParser";
import { dueWebdavSyncs } from "../../jobs/webdavSyncScheduler";
import { runWebdavSync } from "../../services/webdavSync/runSync";
import { syncToCloudIfEnabled, testConnection } from "../../services/cloudSyncService";

/**
 * forgejo#392, invariant 2 ("off means off") for the services ES1 found
 * still answering after an admin switched them off: self-hosted routing, the
 * keyless logo tiers, WebDAV (accounts AND instance backups). The two services
 * that cannot honour "off" without breaking the app are `alwaysOn`.
 */
describe("external services: off means off (selfHostedRouting, logos, webdav, alwaysOn)", () => {
  let adminId: string;
  let userId: string;
  let adminCookie: string;
  let rowId: number;
  const fetchSpy = jest.spyOn(global, "fetch");

  const adminPut = (id: string, body: object) =>
    request(app).put(`/api/v1/admin/external-services/${id}`).set("Cookie", adminCookie).send(body);
  const disable = (id: string) => adminPut(id, { enabled: false }).expect(200);
  const enable = (id: string) => adminPut(id, { enabled: true }).expect(200);

  beforeAll(async () => {
    const mk = async (name: string, isAdmin: boolean) =>
      (
        await prisma.user.create({
          data: {
            username: `eso-${name}-${Date.now()}`,
            passwordHash: await hashPassword("pw-123456"),
            isAdmin,
            isActive: true,
          },
        })
      ).id;
    adminId = await mk("admin", true);
    userId = await mk("user", false);
    adminCookie = `auth_token=${generateToken(adminId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
    __resetNegativeCacheForTests();
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        externalServicePolicy: {},
        routingProvider: "custom",
        routingCustomUrl: "https://osrm.example.com",
        railRoutingUrl: "https://rail.example.com",
        operatorLogosOpenDataEnabled: true,
        webdavSyncEnabled: true,
        webdavUrl: "https://dav.example.com/dav",
        webdavUsername: "u",
        webdavPasswordEncrypted: encryptApiKey("pw-0123456789"),
        fxCdnFallbackEnabled: true,
        openaiCompatBaseUrl: null,
      },
    });
    await prisma.userWebdavSync.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        externalServicePolicy: {},
        routingProvider: null,
        routingCustomUrl: null,
        railRoutingUrl: null,
        webdavSyncEnabled: false,
        webdavUrl: null,
        webdavUsername: null,
        webdavPasswordEncrypted: null,
      },
    });
    await prisma.userWebdavSync.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  });

  describe("selfHostedRouting", () => {
    it("an admin 'off' makes the custom OSRM, the rail router and the account summary read as not configured", async () => {
      expect(await resolveRouteProvider(userId)).not.toBeNull();
      expect(await railRoutingBaseUrl()).toBe("https://rail.example.com");
      expect((await instanceServicesView()).openRailRouting).toBe(true);

      await disable("selfHostedRouting");

      expect(await resolveRouteProvider(userId)).toBeNull();
      expect(await railRoutingBaseUrl()).toBeNull();
      expect((await instanceServicesView()).openRailRouting).toBe(false);

      await enable("selfHostedRouting");
      expect(await resolveRouteProvider(userId)).not.toBeNull();
      expect(await railRoutingBaseUrl()).toBe("https://rail.example.com");
    });
  });

  describe("ollama", () => {
    it("an admin 'off' leaves the rail parser no localhost fallback to probe", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { ollamaUrl: null, llmOllamaOptIn: false },
      });
      expect((await resolveRailLlmChain()).length).toBeGreaterThan(0); // on: the default
      await disable("ollama");
      expect(await resolveRailLlmChain()).toEqual([]);
    });
  });

  describe("logos", () => {
    it("an admin 'off' stops the keyless kiwi/Daisycon tiers and the Wikimedia operator lookup", async () => {
      await resolveAirlineLogo("ZQ", "logo");
      expect(fetchSpy).toHaveBeenCalled(); // on: the tiers are asked

      fetchSpy.mockClear();
      __resetNegativeCacheForTests();
      await disable("logos");
      expect(await resolveAirlineLogo("ZR", "logo")).toBeNull();
      expect(await answerOperatorMark("rental", "Zzyzx Rentals GmbH")).toEqual({
        mark: null,
        pending: false,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("webdav", () => {
    const seedAccountSync = () =>
      prisma.userWebdavSync.create({
        data: {
          userId,
          enabled: true,
          url: "https://dav.example.com/remote.php/dav",
          username: "u",
          passwordEncrypted: encryptApiKey("pw-0123456789"),
        },
      });

    it("an admin 'off' stops the accounts' syncs, not only the instance backups", async () => {
      await seedAccountSync();
      expect(await dueWebdavSyncs(new Date())).toContain(userId);
      await disable("webdav");
      expect(await dueWebdavSyncs(new Date())).not.toContain(userId);
      await expect(runWebdavSync(userId)).rejects.toBeDefined();
    });

    it("an admin 'off' stops the instance backups too, and 'on' restores them", async () => {
      await disable("webdav");
      await syncToCloudIfEnabled("backup-that-does-not-exist");
      expect(fetchSpy).not.toHaveBeenCalled();
      const test = await testConnection();
      expect(test.success).toBe(false);

      const view = await request(app)
        .get("/api/v1/admin/external-services")
        .set("Cookie", adminCookie)
        .expect(200);
      const webdav = view.body.categories
        .flatMap((c: { services: Array<{ id: string; enabled: boolean }> }) => c.services)
        .find((s: { id: string }) => s.id === "webdav");
      expect(webdav.enabled).toBe(false);

      await enable("webdav");
      expect((await instanceServicesView()).transitous).toBeDefined();
      const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
      expect(row.webdavSyncEnabled).toBe(true); // the instance backup switch is untouched
    });
  });

  describe("alwaysOn (geocoder, fx)", () => {
    const find = async (id: string) => {
      const res = await request(app)
        .get("/api/v1/admin/external-services")
        .set("Cookie", adminCookie)
        .expect(200);
      return res.body.categories
        .flatMap((c: { services: Array<Record<string, unknown>> }) => c.services)
        .find((s: Record<string, unknown>) => s.id === id) as Record<string, unknown>;
    };

    it.each(["geocoder", "fx"])(
      "%s is reported always on and refuses to be switched off",
      async (id) => {
        expect((await find(id)).alwaysOn).toBe(true);
        const res = await adminPut(id, { enabled: false });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_FAILED");
        const view = await find(id);
        expect(view.enabled).toBe(true);
      }
    );

    it("a stale policy entry cannot turn an always-on service off", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { externalServicePolicy: { disabled: ["geocoder", "fx"] } },
      });
      expect((await find("geocoder")).enabled).toBe(true);
      expect((await find("fx")).enabled).toBe(true);
    });

    it("the FX CDN fallback stays its own switch on the fx service", async () => {
      await adminPut("fx", { fields: { cdnFallback: false } }).expect(200);
      const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
      expect(row.fxCdnFallbackEnabled).toBe(false);
      const fx = await find("fx");
      expect(fx.enabled).toBe(true);
    });
  });

  describe("account AI consent follows the destination", () => {
    const seedConsent = () =>
      prisma.userSettings.upsert({
        where: { userId },
        create: {
          userId,
          data: {},
          externalServicePrefs: { disabled: [], aiConsent: { custom: "2026-10-30T10:00:00Z" } },
        },
        update: {
          externalServicePrefs: { disabled: [], aiConsent: { custom: "2026-10-30T10:00:00Z" } },
        },
      });
    const consented = async () =>
      JSON.stringify(
        (await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).externalServicePrefs
      ).includes('"custom"');

    it("the legacy parser-settings route withdraws consent when the custom address changes", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { openaiCompatBaseUrl: "https://llm-old.example.com/v1" },
      });
      await seedConsent();
      await request(app)
        .put("/api/v1/admin/parser-settings")
        .set("Cookie", adminCookie)
        .send({ openaiCompatBaseUrl: "https://llm-new.example.com/v1" })
        .expect(200);
      expect(await consented()).toBe(false);
    });

    it("the same address saved again keeps the consent", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { openaiCompatBaseUrl: "https://llm-old.example.com/v1" },
      });
      await seedConsent();
      await request(app)
        .put("/api/v1/admin/parser-settings")
        .set("Cookie", adminCookie)
        .send({ openaiCompatBaseUrl: "https://llm-old.example.com/v1" })
        .expect(200);
      expect(await consented()).toBe(true);
    });

    it("the external-services façade withdraws consent when the custom address changes", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: { openaiCompatBaseUrl: "https://llm-old.example.com/v1" },
      });
      await seedConsent();
      await adminPut("customLlm", {
        fields: { baseUrl: "https://llm-new.example.com/v1" },
      }).expect(200);
      expect(await consented()).toBe(false);
    });
  });
});

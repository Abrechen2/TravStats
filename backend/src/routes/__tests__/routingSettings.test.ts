import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption";
import { getApiKey } from "../../services/apiKeyResolver";

/**
 * Task 3 (Phase 3 tour routing providers): DB columns + API-key chain +
 * connection test for the routing provider settings.
 *
 * Two admin-only fields (`routingProvider`, `routingCustomUrl`) and two
 * global/user key pairs (openrouteservice, graphhopper) round-trip through
 * `PUT/GET /api/v1/admin/api-keys` (extended alongside the existing global
 * flight-lookup keys) and `PUT/GET /api/v1/settings/api-keys` (extended
 * alongside the existing per-user flight-lookup keys) respectively.
 */
describe("Tour routing provider settings (Phase 3)", () => {
  let adminUser: { id: string };
  let adminCookie: string;
  let regularUser: { id: string };
  let regularCookie: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    adminUser = await prisma.user.create({
      data: {
        username: `admin-routing-settings-${timestamp}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(adminUser.id)}`;

    regularUser = await prisma.user.create({
      data: {
        username: `user-routing-settings-${timestamp}`,
        passwordHash: await hashPassword("user-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    regularCookie = `auth_token=${generateToken(regularUser.id)}`;

    const existing = await prisma.adminSettings.findFirst();
    if (!existing) {
      await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          defaultVisionParser: "auto",
          defaultTextParser: "auto",
          allowUserFlightApiKeys: true,
        },
      });
    }
  });

  afterEach(async () => {
    await prisma.adminSettings.updateMany({
      data: {
        globalOpenrouteserviceApiKey: null,
        globalGraphhopperApiKey: null,
        routingProvider: null,
        routingCustomUrl: null,
      },
    });
    await prisma.userSettings.updateMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
      data: { openrouteserviceApiKey: null, graphhopperApiKey: null },
    });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({
      where: { userId: { in: [adminUser.id, regularUser.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, regularUser.id] } } });
    await prisma.$disconnect();
  });

  describe("API key chain (apiKeyResolver.getApiKey)", () => {
    it("resolves the user's own OpenRouteService key over a configured global key", async () => {
      await prisma.userSettings.upsert({
        where: { userId: regularUser.id },
        update: { openrouteserviceApiKey: encryptApiKey("user-ors-key-123456") },
        create: {
          userId: regularUser.id,
          data: {},
          openrouteserviceApiKey: encryptApiKey("user-ors-key-123456"),
        },
      });
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { globalOpenrouteserviceApiKey: encryptApiKey("global-ors-key-654321") },
      });

      const resolved = await getApiKey("openrouteservice", regularUser.id);
      expect(resolved).toBe("user-ors-key-123456");
    });

    it("resolves the user's own GraphHopper key over a configured global key", async () => {
      await prisma.userSettings.upsert({
        where: { userId: regularUser.id },
        update: { graphhopperApiKey: encryptApiKey("user-gh-key-123456") },
        create: {
          userId: regularUser.id,
          data: {},
          graphhopperApiKey: encryptApiKey("user-gh-key-123456"),
        },
      });
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { globalGraphhopperApiKey: encryptApiKey("global-gh-key-654321") },
      });

      const resolved = await getApiKey("graphhopper", regularUser.id);
      expect(resolved).toBe("user-gh-key-123456");
    });

    it("falls back to the global key when the user has none of their own", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { globalOpenrouteserviceApiKey: encryptApiKey("only-global-ors-key") },
      });

      const resolved = await getApiKey("openrouteservice", regularUser.id);
      expect(resolved).toBe("only-global-ors-key");
    });
  });

  describe("PUT /api/v1/admin/api-keys — routingCustomUrl validation", () => {
    it("rejects a malformed custom routing URL with 400", async () => {
      const res = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "custom", routingCustomUrl: "not a url" });
      expect(res.status).toBe(400);

      const row = await prisma.adminSettings.findFirst();
      expect(row?.routingCustomUrl).toBeNull();
    });

    it("rejects a non-http(s) protocol with 400", async () => {
      const res = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "custom", routingCustomUrl: "ftp://osrm.local" });
      expect(res.status).toBe(400);
    });

    it("ACCEPTS a private-IP custom routing URL — deliberately, no egress restriction", async () => {
      const res = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "custom", routingCustomUrl: "http://192.168.1.50:5000/" });
      expect(res.status).toBe(200);
      // Normalised: trailing slash stripped, same as normalizeImmichBaseUrl.
      expect(res.body.settings.routingCustomUrl).toBe("http://192.168.1.50:5000");
      expect(res.body.settings.routingProvider).toBe("custom");

      const row = await prisma.adminSettings.findFirst();
      expect(row?.routingCustomUrl).toBe("http://192.168.1.50:5000");
      expect(row?.routingProvider).toBe("custom");
    });

    it("also accepts a loopback custom routing URL", async () => {
      const res = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "custom", routingCustomUrl: "http://127.0.0.1:5000" });
      expect(res.status).toBe(200);
      expect(res.body.settings.routingCustomUrl).toBe("http://127.0.0.1:5000");
    });
  });

  describe("Admin settings round-trip through GET/PUT", () => {
    it("persists routingProvider, routingCustomUrl and both global keys, then echoes them back on GET", async () => {
      const putRes = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({
          routingProvider: "openrouteservice",
          globalOpenrouteserviceApiKey: "a-real-ors-key-01234",
          globalGraphhopperApiKey: "a-real-gh-key-01234",
        });
      expect(putRes.status).toBe(200);
      expect(putRes.body.settings.routingProvider).toBe("openrouteservice");
      expect(putRes.body.settings.globalOpenrouteserviceApiKey).toContain("****");
      expect(putRes.body.settings.globalGraphhopperApiKey).toContain("****");

      const getRes = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
      expect(getRes.status).toBe(200);
      expect(getRes.body.routingProvider).toBe("openrouteservice");
      expect(getRes.body.globalOpenrouteserviceApiKey).toContain("****");
      expect(getRes.body.globalGraphhopperApiKey).toContain("****");

      // DB truth: the real plaintext round-trips through encryption.
      const row = await prisma.adminSettings.findFirst();
      expect(decryptApiKey(row?.globalOpenrouteserviceApiKey ?? null)).toBe("a-real-ors-key-01234");
      expect(decryptApiKey(row?.globalGraphhopperApiKey ?? null)).toBe("a-real-gh-key-01234");
      expect(row?.routingProvider).toBe("openrouteservice");
    });

    it("clears routingProvider back to null with an explicit null", async () => {
      await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "graphhopper" })
        .expect(200);

      const clearRes = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: null });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.settings.routingProvider).toBeNull();

      const row = await prisma.adminSettings.findFirst();
      expect(row?.routingProvider).toBeNull();
    });

    it("rejects a routingProvider outside the closed set", async () => {
      const res = await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ routingProvider: "not-a-real-provider" });
      expect(res.status).toBe(400);
    });
  });

  describe("A key never appears in a GET response body", () => {
    it("admin GET returns only masked keys, never the plaintext", async () => {
      await request(app)
        .put("/api/v1/admin/api-keys")
        .set("Cookie", adminCookie)
        .send({ globalOpenrouteserviceApiKey: "super-secret-plaintext-ors" })
        .expect(200);

      const getRes = await request(app).get("/api/v1/admin/api-keys").set("Cookie", adminCookie);
      expect(getRes.status).toBe(200);
      expect(JSON.stringify(getRes.body)).not.toContain("super-secret-plaintext-ors");
      expect(getRes.body.globalOpenrouteserviceApiKey).toContain("****");
    });

    it("user GET returns only a hasKey boolean, never any key material", async () => {
      await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ openrouteserviceApiKey: "super-secret-plaintext-user-ors" })
        .expect(200);

      const getRes = await request(app)
        .get("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie);
      expect(getRes.status).toBe(200);
      expect(JSON.stringify(getRes.body)).not.toContain("super-secret-plaintext-user-ors");
      expect(getRes.body.openrouteservice).toEqual(
        expect.objectContaining({ hasKey: true })
      );
    });
  });

  describe("PUT/GET /api/v1/settings/api-keys — user routing keys", () => {
    it("round-trips a user's own graphhopper key", async () => {
      const putRes = await request(app)
        .put("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie)
        .send({ graphhopperApiKey: "a-real-user-gh-key" });
      expect(putRes.status).toBe(200);
      expect(putRes.body.apiKeys.graphhopper.hasKey).toBe(true);
      expect(putRes.body.apiKeys.graphhopper.isShared).toBe(false);

      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId: regularUser.id } });
      expect(decryptApiKey(row.graphhopperApiKey)).toBe("a-real-user-gh-key");

      const getRes = await request(app)
        .get("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie);
      expect(getRes.body.graphhopper.hasKey).toBe(true);
    });

    it("reports isShared when only a global key is configured", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { globalOpenrouteserviceApiKey: encryptApiKey("shared-ors-key") },
      });

      const getRes = await request(app)
        .get("/api/v1/settings/api-keys")
        .set("Cookie", regularCookie);
      expect(getRes.status).toBe(200);
      expect(getRes.body.openrouteservice.hasKey).toBe(false);
      expect(getRes.body.openrouteservice.hasAccess).toBe(true);
      expect(getRes.body.openrouteservice.isShared).toBe(true);
    });
  });

  describe("POST /test/openrouteservice and /test/graphhopper — no-key branch (no network call)", () => {
    it("user route: 400 when neither a user nor a global key is configured", async () => {
      const ors = await request(app)
        .post("/api/v1/settings/api-keys/test/openrouteservice")
        .set("Cookie", regularCookie)
        .send({});
      expect(ors.status).toBe(400);
      expect(ors.body.success).toBe(false);

      const gh = await request(app)
        .post("/api/v1/settings/api-keys/test/graphhopper")
        .set("Cookie", regularCookie)
        .send({});
      expect(gh.status).toBe(400);
      expect(gh.body.success).toBe(false);
    });

    it("admin route: 400 when no global key is configured", async () => {
      const ors = await request(app)
        .post("/api/v1/admin/api-keys/test/openrouteservice")
        .set("Cookie", adminCookie)
        .send({});
      expect(ors.status).toBe(400);
      expect(ors.body.messageKey).toBe("notConfigured");

      const gh = await request(app)
        .post("/api/v1/admin/api-keys/test/graphhopper")
        .set("Cookie", adminCookie)
        .send({});
      expect(gh.status).toBe(400);
      expect(gh.body.messageKey).toBe("notConfigured");
    });
  });
});

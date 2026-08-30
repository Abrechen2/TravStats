import { describe, it, expect, beforeAll, afterEach, afterAll, jest } from "@jest/globals";

import { prisma } from "../../../../db";
import { hashPassword } from "../../../../utils/password";
import { encryptApiKey } from "../../../../utils/encryption";
import * as apiKeyResolver from "../../../apiKeyResolver";
import { resolveRouteProvider, describeRoutingAvailability } from "../resolveProvider";

/**
 * Task 4 (Phase 3 tour routing providers): resolves which routing provider,
 * if any, is actually usable right now.
 *
 * The rule this module exists to enforce: a provider that is SELECTED in
 * `admin_settings.routing_provider` but not USABLE (no key anywhere for a
 * keyed provider, no/invalid URL for "custom") must read as unconfigured —
 * `null` from `resolveRouteProvider`, `{ configured: false, providerId:
 * null }` from `describeRoutingAvailability`. Returning a provider that
 * would 401/fail on every call is the defect this task exists to prevent.
 */
describe("resolveRouteProvider / describeRoutingAvailability", () => {
  let user: { id: string };

  beforeAll(async () => {
    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `resolve-provider-user-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });

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
    jest.restoreAllMocks();
    await prisma.adminSettings.updateMany({
      data: {
        globalOpenrouteserviceApiKey: null,
        globalGraphhopperApiKey: null,
        routingProvider: null,
        routingCustomUrl: null,
      },
    });
    await prisma.userSettings.updateMany({
      where: { userId: user.id },
      data: { openrouteserviceApiKey: null, graphhopperApiKey: null },
    });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  describe("nothing configured", () => {
    it("resolveRouteProvider returns null", async () => {
      const resolved = await resolveRouteProvider(user.id);
      expect(resolved).toBeNull();
    });

    it("describeRoutingAvailability reports configured: false, providerId: null", async () => {
      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: false, providerId: null });
    });
  });

  describe('routingProvider = "openrouteservice"', () => {
    it("with a key configured, resolves an ORS provider", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          routingProvider: "openrouteservice",
          globalOpenrouteserviceApiKey: encryptApiKey("a-real-ors-key"),
        },
      });

      const resolved = await resolveRouteProvider(user.id);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe("openrouteservice");

      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: true, providerId: "openrouteservice" });
    });

    it("with NO key anywhere, reads as unconfigured — the case that matters", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { routingProvider: "openrouteservice" },
      });

      const resolved = await resolveRouteProvider(user.id);
      expect(resolved).toBeNull();

      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: false, providerId: null });
    });
  });

  describe('routingProvider = "custom"', () => {
    it("with a valid URL, resolves the custom adapter and never looks up a key", async () => {
      const getApiKeySpy = jest.spyOn(apiKeyResolver, "getApiKey");
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          routingProvider: "custom",
          routingCustomUrl: "http://osrm.local:5000",
        },
      });

      // No user key, no global key, no ENV key anywhere in this fixture —
      // if resolution succeeds anyway, that proves no key lookup happened.
      const resolved = await resolveRouteProvider(user.id);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe("custom");
      expect(getApiKeySpy).not.toHaveBeenCalled();

      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: true, providerId: "custom" });
      expect(getApiKeySpy).not.toHaveBeenCalled();
    });

    it("with a malformed URL, returns null rather than throwing", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          routingProvider: "custom",
          routingCustomUrl: "not a valid url at all",
        },
      });

      await expect(resolveRouteProvider(user.id)).resolves.toBeNull();

      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: false, providerId: null });
    });

    it("with no URL at all, returns null rather than throwing", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { routingProvider: "custom", routingCustomUrl: null },
      });

      await expect(resolveRouteProvider(user.id)).resolves.toBeNull();
    });
  });

  describe("an unknown value in routing_provider", () => {
    it("returns null instead of crashing", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      // Bypass the Zod-guarded PUT route to simulate a stale/hand-edited row
      // holding a value outside the current closed set.
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { routingProvider: "some-retired-provider" },
      });

      await expect(resolveRouteProvider(user.id)).resolves.toBeNull();

      const availability = await describeRoutingAvailability(user.id);
      expect(availability).toEqual({ configured: false, providerId: null });
    });
  });

  describe("resolveRouteProvider with no userId argument", () => {
    it("still resolves against the global key when no user is given", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          routingProvider: "graphhopper",
          globalGraphhopperApiKey: encryptApiKey("a-real-gh-key"),
        },
      });

      const resolved = await resolveRouteProvider();
      expect(resolved?.id).toBe("graphhopper");
    });
  });
});

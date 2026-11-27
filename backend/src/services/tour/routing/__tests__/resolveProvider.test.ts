import { describe, it, expect, beforeAll, afterEach, afterAll, jest } from "@jest/globals";

import { prisma } from "../../../../db";
import { hashPassword } from "../../../../utils/password";
import { encryptApiKey } from "../../../../utils/encryption";
import * as apiKeyResolver from "../../../apiKeyResolver";
import { routingViewFor } from "../../../externalServices/accountView";
import {
  resolveRouteProvider,
  resolveRouting,
  describeRoutingAvailability,
} from "../resolveProvider";
import { recordProviderOutcome, resetProviderHealth } from "../providerHealth";

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
      expect(availability).toEqual({ configured: false, providerId: null, failing: null });
    });
  });

  describe("Automatisch with a provider that refuses the instance (#411)", () => {
    afterEach(() => resetProviderHealth());

    it("skips an ORS that answered 410/401 for the GraphHopper whose key is set, and says ORS is failing only while it answers", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          routingProvider: null,
          globalOpenrouteserviceApiKey: encryptApiKey("a-retired-ors-key"),
          globalGraphhopperApiKey: encryptApiKey("a-working-gh-key"),
        },
      });
      expect((await resolveRouteProvider(user.id))?.id).toBe("openrouteservice");

      recordProviderOutcome("openrouteservice", "auth");
      expect((await resolveRouteProvider(user.id))?.id).toBe("graphhopper");
      expect((await describeRoutingAvailability(user.id)).failing).toBeNull();

      // Both refuse: the first answers so its refusal is reported, not hidden.
      recordProviderOutcome("graphhopper", "auth");
      const both = await describeRoutingAvailability(user.id);
      expect(both).toEqual({
        configured: true,
        providerId: "openrouteservice",
        failing: { providerId: "openrouteservice", reason: "auth" },
      });
    });

    it("never picks ORS without a key", async () => {
      const settingsId = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { routingProvider: null, globalGraphhopperApiKey: encryptApiKey("gh") },
      });
      expect((await resolveRouteProvider(user.id))?.id).toBe("graphhopper");
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
      expect(availability).toEqual({
        configured: true,
        providerId: "openrouteservice",
        failing: null,
      });
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
      expect(availability).toEqual({ configured: false, providerId: null, failing: null });
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
      expect(availability).toEqual({ configured: true, providerId: "custom", failing: null });
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
      expect(availability).toEqual({ configured: false, providerId: null, failing: null });
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
      expect(availability).toEqual({ configured: false, providerId: null, failing: null });
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

  describe("routingProvider = null means Automatisch, not Aus", () => {
    let other: { id: string };

    beforeAll(async () => {
      other = await prisma.user.create({
        data: {
          username: `resolve-provider-other-${Date.now()}`,
          passwordHash: await hashPassword("test-password"),
          isAdmin: false,
          isActive: true,
        },
      });
    });

    afterAll(async () => {
      await prisma.userSettings.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });

    const giveOwnKey = (userId: string, data: Record<string, string | null>) =>
      prisma.userSettings.upsert({
        where: { userId },
        update: data,
        create: { userId, data: {}, ...data },
      });

    it("a personal ORS key routes for its owner with no instance key — and for nobody else", async () => {
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("my-own-ors-key") });

      const mine = await resolveRouting(user.id);
      expect(mine.provider?.id).toBe("openrouteservice");
      expect(mine.keySource).toBe("account");
      expect(mine.mode).toBe("auto");

      const theirs = await resolveRouting(other.id);
      expect(theirs.provider).toBeNull();
      expect(theirs.hint).toBe("noProvider");
      await expect(resolveRouteProvider(other.id)).resolves.toBeNull();
    });

    it("prefers ORS over GraphHopper, then falls to a valid self-hosted URL", async () => {
      const id = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id },
        data: {
          globalGraphhopperApiKey: encryptApiKey("gh"),
          routingCustomUrl: "http://osrm.local:5000",
        },
      });
      expect((await resolveRouting(user.id)).provider?.id).toBe("graphhopper");
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("ors") });
      expect((await resolveRouting(user.id)).provider?.id).toBe("openrouteservice");
      await giveOwnKey(user.id, { openrouteserviceApiKey: null });
      await prisma.adminSettings.update({ where: { id }, data: { globalGraphhopperApiKey: null } });
      const self = await resolveRouting(user.id);
      expect(self.provider?.id).toBe("custom");
      expect(self.keySource).toBe("selfHosted");
    });

    it("own key beats the instance key of the same provider", async () => {
      const id = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id },
        data: { globalOpenrouteserviceApiKey: encryptApiKey("instance") },
      });
      expect((await resolveRouting(other.id)).keySource).toBe("instance");
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("mine") });
      expect((await resolveRouting(user.id)).keySource).toBe("account");
    });

    it("an explicit provider the user cannot use falls back to the user's OWN key only", async () => {
      const id = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id },
        data: {
          routingProvider: "graphhopper",
          globalOpenrouteserviceApiKey: encryptApiKey("instance-ors"),
        },
      });
      // Only the instance's ORS key exists: it must NOT replace the selected provider.
      const without = await resolveRouting(other.id);
      expect(without.provider).toBeNull();
      expect(without.hint).toBe("selectedUnavailable");
      expect(without.mode).toBe("explicit");

      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("mine") });
      const own = await resolveRouting(user.id);
      expect(own.provider?.id).toBe("openrouteservice");
      expect(own.keySource).toBe("account");
    });

    it("never switches provider or key when the provider fails (429/401)", async () => {
      const id = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({
        where: { id },
        data: {
          globalOpenrouteserviceApiKey: encryptApiKey("ors"),
          globalGraphhopperApiKey: encryptApiKey("gh"),
        },
      });
      const fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 429 }));
      const provider = (await resolveRouting(user.id)).provider!;
      expect(provider.id).toBe("openrouteservice");
      const answer = await provider.route({
        from: { lat: 52.5, lon: 13.4 },
        to: { lat: 48.1, lon: 11.6 },
        mode: "road",
        vehicle: "car",
      } as never);
      // The failure is reported with its reason; nothing is retried on another provider or key.
      expect(answer).toEqual({ failure: "rate_limited" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain("openrouteservice");
      expect((await resolveRouting(user.id)).provider?.id).toBe("openrouteservice");
    });

    it("'off' keeps routing off on purpose, even with a personal key; null does not", async () => {
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("mine") });
      const id = (await prisma.adminSettings.findFirst())!.id;
      await prisma.adminSettings.update({ where: { id }, data: { routingProvider: "off" } });
      const off = await resolveRouting(user.id);
      expect(off.provider).toBeNull();
      expect(off.mode).toBe("off");
      expect(off.hint).toBe("off");
      await prisma.adminSettings.update({ where: { id }, data: { routingProvider: null } });
      expect((await resolveRouting(user.id)).provider?.id).toBe("openrouteservice");
    });

    it("the account view reports the same resolution the handlers run", async () => {
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("mine") });
      await expect(routingViewFor(user.id)).resolves.toEqual({
        mode: "auto",
        selected: null,
        providerId: "openrouteservice",
        keySource: "account",
        hint: null,
      });
      await expect(routingViewFor(other.id)).resolves.toMatchObject({
        providerId: null,
        hint: "noProvider",
      });
    });

    it("an account that switched the service off gets nothing, even with a key", async () => {
      await giveOwnKey(user.id, { openrouteserviceApiKey: encryptApiKey("mine") });
      await prisma.userSettings.update({
        where: { userId: user.id },
        data: { externalServicePrefs: { disabled: ["openrouteservice"] } },
      });
      expect((await resolveRouting(user.id)).provider).toBeNull();
      await prisma.userSettings.update({
        where: { userId: user.id },
        data: { externalServicePrefs: {} },
      });
    });
  });
});

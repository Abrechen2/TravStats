import { describe, it, expect, beforeAll, afterEach, afterAll, jest } from "@jest/globals";
import { prisma } from "../../../../db";
import { hashPassword } from "../../../../utils/password";
import { updatePolicy } from "../../../externalServices/policy";
import { revokeUseConsent } from "../../../externalServices/useConsent";
import {
  describeRoutingAvailability,
  resolveRouteChoice,
  resolveRouteProvider,
} from "../resolveProvider";

/**
 * The public router is the last resort when NO provider is configured, and it is
 * never used before the account confirmed it: nothing is sent until then.
 */
describe("resolveRouteChoice (public routing fallback)", () => {
  let user: { id: string };
  const fetchSpy = jest.fn();

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        username: `route-choice-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    if (!(await prisma.adminSettings.findFirst())) await prisma.adminSettings.create({ data: {} });
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(async () => {
    fetchSpy.mockReset();
    await prisma.adminSettings.updateMany({
      data: { routingProvider: null, routingCustomUrl: null, internetEnabled: true },
    });
    await updatePolicy((p) => ({ ...p, disabled: [] }));
    await prisma.userSettings.updateMany({
      where: { userId: user.id },
      data: { externalServicePrefs: {} },
    });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  it("asks first and sends nothing: no request before the account confirmed", async () => {
    const choice = await resolveRouteChoice(user.id, undefined, 2);
    expect(choice).toMatchObject({
      kind: "confirm",
      disclosure: {
        serviceId: "publicRouting",
        host: "routing.openstreetmap.de",
        location: "cloud",
        fields: ["positions"],
        pointCount: 2,
      },
    });
    expect(await resolveRouteProvider(user.id)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers the public fallback to callers that can ask, without calling it configured, while the confirmation is pending", async () => {
    expect(await describeRoutingAvailability(user.id)).toMatchObject({
      configured: false,
      providerId: null,
      publicFallback: true,
    });
    await prisma.adminSettings.updateMany({ data: { routingProvider: "off" } });
    expect(await describeRoutingAvailability(user.id)).toMatchObject({ configured: false });
  });

  it("'once' serves that request only; the next one asks again", async () => {
    const asked = await resolveRouteChoice(user.id);
    if (asked.kind !== "confirm") throw new Error("expected a confirmation request");
    const target = `${asked.disclosure.provider}@${asked.disclosure.host}`;
    const once = await resolveRouteChoice(user.id, { mode: "once", target });
    expect(once.kind).toBe("provider");
    expect((await resolveRouteChoice(user.id)).kind).toBe("confirm");
  });

  it("'always' persists, so a caller with nobody to ask may use it afterwards", async () => {
    const asked = await resolveRouteChoice(user.id);
    if (asked.kind !== "confirm") throw new Error("expected a confirmation request");
    const target = `${asked.disclosure.provider}@${asked.disclosure.host}`;
    expect((await resolveRouteChoice(user.id, { mode: "always", target })).kind).toBe("provider");
    expect((await resolveRouteChoice(user.id)).kind).toBe("provider");
    expect(await resolveRouteProvider(user.id)).not.toBeNull();
    // Revoked, it asks again; a confirmation given for another target proves nothing.
    await revokeUseConsent(user.id, "publicRouting");
    expect(
      (await resolveRouteChoice(user.id, { mode: "once", target: "osrm@elsewhere" })).kind
    ).toBe("confirm");
  });

  it("is used only when no provider is configured", async () => {
    await prisma.adminSettings.updateMany({
      data: { routingProvider: "custom", routingCustomUrl: "http://osrm.local:5000" },
    });
    const configured = await resolveRouteChoice(user.id);
    expect(configured.kind).toBe("provider");
    if (configured.kind === "provider")
      expect(configured.provider.cacheIdentity).toContain("osrm.local");
    // An explicit choice that does not work is not replaced by a public server.
    await prisma.adminSettings.updateMany({ data: { routingProvider: "openrouteservice" } });
    expect((await resolveRouteChoice(user.id)).kind).toBe("none");
    await prisma.adminSettings.updateMany({ data: { routingProvider: "off" } });
    expect((await resolveRouteChoice(user.id)).kind).toBe("none");
  });

  it("stays out when the admin switch, the account switch or the internet switch is off", async () => {
    await updatePolicy((p) => ({ ...p, disabled: ["publicRouting"] }));
    expect((await resolveRouteChoice(user.id)).kind).toBe("none");
    await updatePolicy((p) => ({ ...p, disabled: [] }));
    await prisma.adminSettings.updateMany({ data: { internetEnabled: false } });
    expect((await resolveRouteChoice(user.id)).kind).toBe("none");
  });
});

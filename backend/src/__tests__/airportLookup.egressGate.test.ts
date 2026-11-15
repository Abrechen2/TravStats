import { prisma } from "../db";
import { ensureAdminSettingsRow } from "../services/adminSettingsRow";
import { lookupOrCreateAirport, resetAirportLookupCaches } from "../services/airportLookup";
import { assertEgressAllowed, EgressBlockedError } from "../services/externalServices/egress";
import { loadPolicy, savePolicy } from "../services/externalServices/policy";

/**
 * forgejo#392 — the airport-data.com lookup and the OurAirports CSV download
 * went out without asking the external-services catalogue. Off must mean off,
 * and "off" must be reported as itself, not as "no such airport".
 */
describe("airport egress is gated by the catalogue (forgejo#392)", () => {
  const realFetch = global.fetch;
  let fetchSpy: jest.Mock;
  let savedPolicy: Awaited<ReturnType<typeof loadPolicy>>;
  let adminId: number;

  beforeAll(async () => {
    adminId = await ensureAdminSettingsRow();
    savedPolicy = await loadPolicy();
  });
  beforeEach(async () => {
    resetAirportLookupCaches();
    await prisma.airport.deleteMany({ where: { iata: "ZQB" } });
    fetchSpy = jest.fn(async () => new Response("{}", { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(async () => {
    global.fetch = realFetch;
    await savePolicy(savedPolicy);
    await prisma.adminSettings.update({ where: { id: adminId }, data: { internetEnabled: true } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("an admin-disabled airportData service makes zero outbound requests and reports blocked", async () => {
    await savePolicy({ ...savedPolicy, disabled: [...savedPolicy.disabled, "airportData"] });
    await expect(lookupOrCreateAirport("ZQB")).resolves.toEqual({
      status: "unavailable",
      reason: "blocked",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the master internet switch off blocks it too, and a blocked miss is not remembered as not-found", async () => {
    await prisma.adminSettings.update({ where: { id: adminId }, data: { internetEnabled: false } });
    await expect(lookupOrCreateAirport("ZQB")).resolves.toMatchObject({ reason: "blocked" });
    expect(fetchSpy).not.toHaveBeenCalled();
    await prisma.adminSettings.update({ where: { id: adminId }, data: { internetEnabled: true } });
    await lookupOrCreateAirport("ZQB");
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("the catalogue download guard throws a named error when the service is off", async () => {
    await savePolicy({ ...savedPolicy, disabled: [...savedPolicy.disabled, "airportData"] });
    await expect(assertEgressAllowed("airportData")).rejects.toMatchObject({
      name: "EgressBlockedError",
      block: "service_off",
    });
    await expect(assertEgressAllowed("airportData")).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("is allowed by default, so an instance that never opened the page keeps resolving airports", async () => {
    await expect(assertEgressAllowed("airportData")).resolves.toBeUndefined();
  });
});

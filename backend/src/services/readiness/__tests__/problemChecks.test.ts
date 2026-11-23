import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateApiToken } from "../../../utils/apiTokens";
import { loadReadinessContext, resetDiskCache } from "../context";
import { buildReadinessView, evaluateChecks } from "../evaluate";
import { CHECKS } from "../registry";
import { PROBLEM_RULES, resetZoneMismatchCache } from "../problemEntries";
import type { CheckId } from "../../../shared/readinessCatalogue";

/**
 * The visible-problem checks (owner, 2026-11-23): each fires on the rows it is
 * about and stays silent without them — and the count the copy names is the
 * number of entries the list shows.
 */

const NAMES = ["pc_admin", "pc_user"];
const NOW = new Date("2026-11-23T12:00:00Z");
let adminId: string;
let userId: string;

async function statusOf(
  id: CheckId,
  who: "admin" | "user" = "user"
): Promise<{ status: string; count: number | null } | undefined> {
  const ctx = await loadReadinessContext(who === "admin" ? adminId : userId, who === "admin", NOW);
  const hit = evaluateChecks(ctx).get(id);
  return hit ? { status: hit.status, count: hit.count } : undefined;
}

const flight = (data: Record<string, unknown> = {}) =>
  prisma.flight.create({
    data: {
      userId,
      flightNumber: "LH400",
      depIata: "FRA",
      depLat: 50.0379,
      depLon: 8.5622,
      depTimezone: "Europe/Berlin",
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2025-06-01T08:00:00Z"),
      arrivalTime: new Date("2025-06-01T16:00:00Z"),
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      ...data,
    },
  });

async function wipe(): Promise<void> {
  const ids = [userId, adminId];
  await prisma.flight.deleteMany({ where: { userId: { in: ids } } });
  await prisma.placeVisit.deleteMany({ where: { userId: { in: ids } } });
  await prisma.place.deleteMany({ where: { userId: { in: ids } } });
  await prisma.lodgingStay.deleteMany({ where: { userId: { in: ids } } });
  await prisma.lodging.deleteMany({ where: { userId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { userId: { in: ids } } });
  await prisma.trip.deleteMany({ where: { userId: { in: ids } } });
  await prisma.railJourney.deleteMany({ where: { userId: { in: ids } } });
  await prisma.travTrackPoint.deleteMany({ where: { userId: { in: ids } } });
  await prisma.travTrackDirtyDay.deleteMany({ where: { userId: { in: ids } } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.webAuthnCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userSettings.deleteMany({ where: { userId: { in: ids } } });
}

describe("visible-problem checks", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
    const mk = async (username: string, isAdmin: boolean) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isAdmin },
      });
    adminId = (await mk(NAMES[0], true)).id;
    userId = (await mk(NAMES[1], false)).id;
    if (!(await prisma.adminSettings.findFirst())) await prisma.adminSettings.create({ data: {} });
  });

  beforeEach(async () => {
    resetDiskCache();
    resetZoneMismatchCache();
    await wipe();
    await prisma.adminSettings.updateMany({
      data: {
        railRoutingUrl: null,
        routingProvider: null,
        routingCustomUrl: null,
        globalOpenrouteserviceApiKey: null,
        globalGraphhopperApiKey: null,
      },
    });
  });

  afterAll(async () => {
    await wipe();
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  describe("tracked wrongly", () => {
    it("counts flights without a departure time, not the remembered or cancelled ones", async () => {
      expect(await statusOf("user.flightsNoTimes")).toBeUndefined();
      await flight({ departureTime: null, arrivalTime: null });
      await flight({ departureTime: null, provenance: "remembered" });
      await flight({ departureTime: null, status: "cancelled" });
      expect(await statusOf("user.flightsNoTimes")).toEqual({ status: "needsAction", count: 1 });
    });

    it("counts flights without an arrival time", async () => {
      await flight();
      expect(await statusOf("user.flightsNoArrival")).toBeUndefined();
      await flight({ arrivalTime: null });
      expect(await statusOf("user.flightsNoArrival")).toEqual({ status: "needsAction", count: 1 });
    });

    it("counts flights still stored as legacy fake-UTC wall clocks", async () => {
      await flight();
      expect(await statusOf("user.flightsLegacyTime")).toBeUndefined();
      await flight({ arrTimeSemantics: "LEGACY_FAKE_UTC" });
      expect((await statusOf("user.flightsLegacyTime"))?.count).toBe(1);
    });

    it("counts DATE_ONLY flights as 'Uhrzeit nachtragen'", async () => {
      await flight();
      expect(await statusOf("user.flightsDateOnly")).toBeUndefined();
      await flight({ depTimeSemantics: "DATE_ONLY", arrTimeSemantics: "DATE_ONLY" });
      expect((await statusOf("user.flightsDateOnly"))?.count).toBe(1);
      // An exact departure with a date-only arrival still has no flight time.
      await flight({ arrPrecision: "day" });
      expect((await statusOf("user.flightsDateOnly"))?.count).toBe(2);
    });

    it("finds an exact-looking local midnight that is a placeholder, not a real 08:00", async () => {
      await flight(); // 10:00 Berlin
      await flight({ departureTime: new Date("2025-06-01T23:00:00Z"), depTimezone: "Asia/Tokyo" });
      expect(await statusOf("user.flightsMidnightPlaceholder")).toBeUndefined();
      // 22:00 UTC in summer = 00:00 Berlin.
      await flight({ departureTime: new Date("2025-06-01T22:00:00Z"), depPrecision: "minute" });
      // A day-precision row is already honest about it.
      await flight({ departureTime: new Date("2025-06-02T22:00:00Z"), depPrecision: "day" });
      // A scanned boarding pass carries a real clock: a genuine night flight.
      await flight({
        departureTime: new Date("2025-06-03T22:00:00Z"),
        dataSource: "boarding_pass_scan",
      });
      expect((await statusOf("user.flightsMidnightPlaceholder"))?.count).toBe(1);
    });

    it("counts houses without coordinates", async () => {
      await prisma.lodging.create({ data: { userId, name: "Placed", lat: 48.1, lon: 11.5 } });
      expect(await statusOf("user.staysNoCoords")).toBeUndefined();
      await prisma.lodging.create({ data: { userId, name: "Nowhere" } });
      expect((await statusOf("user.staysNoCoords"))?.count).toBe(1);
    });

    it("counts a place visited twice on one day once, and not two different days", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Marienplatz", lat: 48.137, lon: 11.575 },
      });
      const visit = (at: string) =>
        prisma.placeVisit.create({
          data: { placeId: place.id, userId, visitedAt: new Date(at), visitedAtUtc: new Date(at) },
        });
      await visit("2025-05-01T10:00:00Z");
      await visit("2025-05-02T10:00:00Z");
      expect(await statusOf("user.duplicateVisits")).toBeUndefined();
      await visit("2025-05-01T15:00:00Z");
      await visit("2025-05-01T16:00:00Z");
      expect((await statusOf("user.duplicateVisits"))?.count).toBe(1);
    });

    it("pairs visits by the place's local day, not the server's UTC day", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Tokyo Tower", lat: 35.66, lon: 139.75 },
      });
      // 23:30 UTC on the 1st and 01:00 UTC on the 2nd are both the 2nd in Tokyo.
      for (const at of ["2025-05-01T23:30:00Z", "2025-05-02T01:00:00Z"]) {
        await prisma.placeVisit.create({
          data: {
            placeId: place.id,
            userId,
            visitedAt: new Date(at),
            visitedAtUtc: new Date(at),
            visitedZone: "Asia/Tokyo",
          },
        });
      }
      expect((await statusOf("user.duplicateVisits"))?.count).toBe(1);
    });

    it("finds a stored trip country list that leaves out where a stay was", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: "Alpen", countries: ["DE"] } });
      const house = await prisma.lodging.create({
        data: {
          userId,
          name: "Wien",
          country: "Austria",
          isoCountryCode: "AT",
          lat: 48.2,
          lon: 16.37,
        },
      });
      expect(await statusOf("user.tripCountryMismatch")).toBeUndefined();
      await prisma.lodgingStay.create({
        data: {
          lodgingId: house.id,
          userId,
          tripId: trip.id,
          checkInDate: new Date("2025-07-01T00:00:00Z"),
          checkOutDate: new Date("2025-07-03T00:00:00Z"),
        },
      });
      expect((await statusOf("user.tripCountryMismatch"))?.count).toBe(1);
    });

    it("finds a package priced twice on one trip", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: "Mallorca" } });
      await prisma.booking.create({ data: { userId, tripId: trip.id, price: 1200 } });
      await prisma.booking.create({ data: { userId, tripId: trip.id, price: 80 } });
      expect(await statusOf("user.packageDoublePriced")).toBeUndefined();
      await prisma.booking.create({ data: { userId, tripId: trip.id, price: 1200 } });
      expect((await statusOf("user.packageDoublePriced"))?.count).toBe(1);
    });

    it("finds a stay whose stored zone is not the zone of its place", async () => {
      const house = await prisma.lodging.create({
        data: { userId, name: "Lisboa", lat: 38.72, lon: -9.14 },
      });
      const stay = (zone: string) =>
        prisma.lodgingStay.create({
          data: {
            lodgingId: house.id,
            userId,
            checkInDate: new Date("2025-03-01T00:00:00Z"),
            checkOutDate: new Date("2025-03-02T00:00:00Z"),
            stayZone: zone,
          },
        });
      await stay("Europe/Lisbon");
      expect(await statusOf("user.zoneMismatch")).toBeUndefined();
      await stay("Europe/Berlin");
      resetZoneMismatchCache();
      expect((await statusOf("user.zoneMismatch"))?.count).toBe(1);
    });

    it("lists exactly the entries it counts, each linking to its page", async () => {
      await flight({ departureTime: null, arrivalTime: null });
      const [count, list] = await Promise.all([
        PROBLEM_RULES["user.flightsNoTimes"].count(userId),
        PROBLEM_RULES["user.flightsNoTimes"].list(userId, 100),
      ]);
      expect(list).toHaveLength(count);
      expect(list[0].href).toMatch(/^\/flights\/[0-9a-f-]+$/);
    });
  });

  describe("straight lines", () => {
    const rail = () =>
      prisma.railJourney.create({
        data: {
          userId,
          depStationName: "München Hbf",
          depLat: 48.14,
          depLon: 11.56,
          arrStationName: "Wien Hbf",
          arrLat: 48.18,
          arrLon: 16.37,
          departureTime: new Date("2025-04-01T08:00:00Z"),
        },
      });

    it("asks the admin for a rail router while rides are drawn as chords, and blocks the user's item on it", async () => {
      // Instance-wide: other accounts' rides count too, so measure the step.
      const before = (await statusOf("admin.railRouter", "admin"))?.count ?? 0;
      expect(await statusOf("user.railStraight")).toBeUndefined();
      await rail();
      expect(await statusOf("admin.railRouter", "admin")).toEqual({
        status: "needsAction",
        count: before + 1,
      });
      expect(await statusOf("user.railStraight")).toEqual({ status: "needsAction", count: 1 });
    });

    it("stays silent once a rail router is set", async () => {
      await rail();
      await prisma.adminSettings.updateMany({ data: { railRoutingUrl: "http://router.lan:8989" } });
      expect(await statusOf("admin.railRouter", "admin")).toBeUndefined();
      expect(await statusOf("user.railStraight")).toBeUndefined();
    });

    it("asks to re-route the rail chords once a router is set, and never alongside the router item", async () => {
      await rail();
      await prisma.adminSettings.updateMany({ data: { railRoutingUrl: "http://router.lan:8989" } });
      const reroute = await statusOf("admin.railReroute", "admin");
      expect(reroute?.status).toBe("needsAction");
      expect(reroute?.count).toBeGreaterThanOrEqual(1);
      expect(await statusOf("admin.railRouter", "admin")).toBeUndefined();
      await prisma.adminSettings.updateMany({ data: { railRoutingUrl: null } });
      expect(await statusOf("admin.railReroute", "admin")).toBeUndefined();
    });

    it("names a stored routing key only where routing is off or the chosen provider cannot answer", async () => {
      expect(await statusOf("admin.routingKeyUnused", "admin")).toBeUndefined();
      await prisma.userSettings.create({
        data: { userId: adminId, data: {}, openrouteserviceApiKey: "encrypted-placeholder" },
      });
      // Unset is "Automatisch" (fix/routing-auto): the key routes for its owner, nothing to say.
      expect(await statusOf("admin.routingKeyUnused", "admin")).toBeUndefined();
      await prisma.adminSettings.updateMany({ data: { routingProvider: "off" } });
      expect((await statusOf("admin.routingKeyUnused", "admin"))?.status).toBe("needsAction");
      await prisma.adminSettings.updateMany({ data: { routingProvider: "graphhopper" } });
      expect((await statusOf("admin.routingKeyUnused", "admin"))?.status).toBe("needsAction");
    });
  });

  describe("a failing check stays its own (rc.45)", () => {
    afterEach(() => jest.restoreAllMocks());

    it("shows a check whose facts fail as failed, and every other check still answers", async () => {
      await flight({ departureTime: null });
      jest
        .spyOn(PROBLEM_RULES["user.flightsNoTimes"], "count")
        .mockRejectedValue(new Error("relation does not exist"));
      const ctx = await loadReadinessContext(userId, false, NOW);
      const evaluated = evaluateChecks(ctx);
      expect(evaluated.get("user.flightsNoTimes")).toMatchObject({
        status: "unknown",
        failure: { reason: "factsUnavailable" },
      });
      expect(evaluated.get("user.domains")?.failure).toBeNull();
    });

    it("answers GET /readiness with the failed item instead of a 500 when an evaluator throws", async () => {
      const check = CHECKS.find((c) => c.id === "user.domains")!;
      jest.spyOn(check, "evaluate").mockImplementation(() => {
        throw new Error("boom");
      });
      const view = await buildReadinessView(userId, false, NOW);
      expect(view.items.find((i) => i.id === "user.domains")).toMatchObject({
        status: "unknown",
        failure: { reason: "evaluatorError" },
      });
    });
  });

  describe("TravTrack", () => {
    async function recording(): Promise<void> {
      await prisma.travTrackConfig.upsert({
        where: { id: "default" },
        create: { id: "default", enabled: true },
        update: { enabled: true },
      });
      await prisma.userSettings.create({
        data: { userId, data: {}, locationProvider: "travtrack" },
      });
      const tok = await generateApiToken();
      await prisma.apiToken.create({
        data: {
          userId,
          label: "phone",
          lookupHash: tok.lookupHash,
          hash: tok.hash,
          scope: "write",
          deviceId: "dev-1",
        },
      });
    }
    const point = (at: Date) =>
      prisma.travTrackPoint.create({
        data: {
          userId,
          t: at,
          tS: Math.floor(at.getTime() / 1000),
          lat: 48.1,
          lon: 11.5,
          origin: "test",
          originRef: at.toISOString(),
        },
      });

    afterAll(async () => {
      await prisma.travTrackConfig.updateMany({ data: { enabled: false } });
    });

    it("says the phone went quiet after a day without a position, not before", async () => {
      await recording();
      await point(new Date(NOW.getTime() - 3 * 60 * 60 * 1000));
      expect((await statusOf("user.travtrackSilent"))?.status).toBe("ready");
      await prisma.travTrackPoint.deleteMany({ where: { userId } });
      await point(new Date(NOW.getTime() - 30 * 60 * 60 * 1000));
      expect((await statusOf("user.travtrackSilent"))?.status).toBe("needsAction");
    });

    it("counts visit days the scan left open past the grace period", async () => {
      const day = (d: string, done: number) =>
        prisma.travTrackDirtyDay.create({
          data: { userId, day: new Date(d), version: BigInt(1), done },
        });
      await day("2026-11-22", 0); // still within the grace period
      await day("2026-11-01", 8); // scanned
      expect(await statusOf("user.visitScanBacklog")).toBeUndefined();
      await day("2026-11-10", 1);
      expect((await statusOf("user.visitScanBacklog"))?.count).toBe(1);
    });
  });

  describe("admin account", () => {
    it("asks an admin without a second factor for one, and only an admin", async () => {
      expect((await statusOf("admin.twoFactor", "admin"))?.status).toBe("needsAction");
      await prisma.user.update({ where: { id: adminId }, data: { twoFactorEnabledAt: NOW } });
      expect((await statusOf("admin.twoFactor", "admin"))?.status).toBe("ready");
      expect(await statusOf("admin.twoFactor", "user")).toBeUndefined();
      await prisma.user.update({ where: { id: adminId }, data: { twoFactorEnabledAt: null } });
    });
  });
});

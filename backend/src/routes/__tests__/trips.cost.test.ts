import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * forgejo#274/#275: the trip card and the trip page show the SERVER's cost.
 * Both used to sum bookings, flights, cruises and stays in the browser
 * (`lib/bookingCost.tripCostSources`), which read a flight's bare price, never
 * a train or a rental, and could print a figure the "most expensive trip" tile
 * beside it disagreed with. The server now serves `cost` from the same load
 * and rule as that tile — and, like the UI, leaves out a domain the user does
 * not see, so a hidden beta domain's money never reaches the screen.
 */
describe("GET /trips and /trips/:id — the trip's cost", () => {
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  const ride = (tripId: string, price: number) =>
    prisma.railJourney.create({
      data: {
        userId,
        tripId,
        depStationName: "Köln Hbf",
        depLat: 50.94,
        depLon: 6.96,
        arrStationName: "Paris Nord",
        arrLat: 48.88,
        arrLon: 2.35,
        // A Nightjet: 22:58 in Köln on 1 April, 08:00 in Paris on the 2nd.
        trainCategory: "NJ",
        travelClass: "sleeper",
        depTimezone: "Europe/Berlin",
        arrTimezone: "Europe/Paris",
        departureTime: new Date("2025-04-01T20:58:00Z"),
        arrivalTime: new Date("2025-04-02T06:00:00Z"),
        status: "completed",
        price,
        currency: "EUR",
      },
    });

  const enableDomains = (domains: string[]) =>
    prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: domains, data: {} },
      update: { enabledDomains: domains },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripCostRouteTest" } });
    const user = await prisma.user.create({
      data: { username: "tripCostRouteTest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await prisma.tripExpense.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("serves each trip's cost beside the superlative, from the same rule", async () => {
    await enableDomains(["flight"]);
    const trip = await prisma.trip.create({
      data: { userId, name: "Lisboa", status: "completed" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50,
        depLon: 8,
        arrLat: 38,
        arrLon: -9,
        price: 100,
        taxes: 20,
        fees: 10,
        currency: "EUR",
      },
    });
    // A planned trip is no candidate for the tile, but its card still has a cost.
    const planned = await prisma.trip.create({ data: { userId, name: "Later" } });
    await prisma.flight.create({
      data: {
        userId,
        tripId: planned.id,
        status: "scheduled",
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50,
        depLon: 8,
        arrLat: 38,
        arrLon: -9,
      },
    });

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.trips.map((t: { id: string }) => [t.id, t]));
    expect(byId.get(trip.id)).toMatchObject({
      cost: { spendByCurrency: { EUR: 130 }, unpricedEntries: 0 },
    });
    expect(byId.get(planned.id)).toMatchObject({
      cost: { spendByCurrency: {}, unpricedEntries: 1 },
    });
    expect(res.body.mostExpensiveTrip).toMatchObject({ tripId: trip.id, amount: 130 });

    const detail = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(detail.body.trip.cost).toEqual({ spendByCurrency: { EUR: 130 }, unpricedEntries: 0 });

    // Without insights the list stays as lean as every other caller needs it.
    const lean = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(lean.body.trips[0].cost).toBeUndefined();
  });

  it("leaves out a train ride while rail is hidden, and counts it once it is shown", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Paris", status: "completed" } });
    await ride(trip.id, 89);

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await enableDomains(["flight", "rail"]);
    const hidden = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", cookie);
    expect(hidden.body.trips[0].cost).toEqual({ spendByCurrency: {}, unpricedEntries: 0 });
    expect(hidden.body.mostExpensiveTrip).toBeNull();

    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const shown = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", cookie);
    expect(shown.body.trips[0].cost).toEqual({ spendByCurrency: { EUR: 89 }, unpricedEntries: 0 });
    expect(shown.body.mostExpensiveTrip).toMatchObject({ tripId: trip.id, amount: 89 });

    const detail = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(detail.body.trip.cost).toEqual({ spendByCurrency: { EUR: 89 }, unpricedEntries: 0 });
  });

  /**
   * Review I1/I2 (controller ruling 2026-10-09): the trips page and the
   * statistics' travel account read ONE source set. With the beta switch off,
   * the night train, the rental and the roadtrip's fuel are out of BOTH — the
   * card, the stats row and the night account — and with it on, in both.
   */
  it("prices a trip the same on /trips and /stats/travel-account, hidden domains out of both", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Mixed", status: "completed" } });
    await ride(trip.id, 89);
    await prisma.rentalBooking.create({
      data: {
        userId,
        tripId: trip.id,
        provider: "Testcar",
        pickupStationName: "Paris Nord",
        pickupLat: 48.88,
        pickupLon: 2.35,
        pickupTimezone: "Europe/Paris",
        returnStationName: "Paris Nord",
        returnLat: 48.88,
        returnLon: 2.35,
        returnTimezone: "Europe/Paris",
        pickupTime: new Date("2025-04-02T08:00:00Z"),
        returnTime: new Date("2025-04-04T08:00:00Z"),
        status: "completed",
        price: 210,
        currency: "EUR",
      },
    });
    const roadtrip = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Normandie", mode: "road", kind: "roadtrip" },
    });
    await prisma.tripExpense.createMany({
      data: [
        { userId, routeId: roadtrip.id, kind: "fuel", amount: 30, currency: "EUR" },
        // Trip-wide: no domain, always counted.
        { userId, tripId: trip.id, kind: "parking", amount: 5, currency: "EUR" },
      ],
    });
    await enableDomains(["flight", "rail", "rental", "roadtrip"]);

    const surfaces = async () => {
      const list = await request(app)
        .get("/api/v1/trips?includeInsights=true")
        .set("Cookie", cookie);
      const stats = await request(app).get("/api/v1/stats/travel-account").set("Cookie", cookie);
      expect(stats.status).toBe(200);
      const years = stats.body.account.years as Array<{ railNights: number }>;
      return {
        card: list.body.trips.find((t: { id: string }) => t.id === trip.id).cost.spendByCurrency,
        stats: stats.body.trips.trips.find((t: { id: string }) => t.id === trip.id).spendByCurrency,
        railNights: years.reduce((sum, y) => sum + y.railNights, 0),
      };
    };

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect(await surfaces()).toEqual({ card: { EUR: 5 }, stats: { EUR: 5 }, railNights: 0 });

    await updateInstanceSettings({ betaFeaturesEnabled: true });
    expect(await surfaces()).toEqual({ card: { EUR: 334 }, stats: { EUR: 334 }, railNights: 1 });
  }, 30_000);
});

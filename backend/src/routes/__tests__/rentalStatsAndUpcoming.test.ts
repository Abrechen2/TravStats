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
 * Rental statistics, the upcoming feed and the invoice reminder (spec
 * 2026-10-01-rental-domain-design §7.4, §8, D11 b). Invented values; rows are
 * written directly so a test can place them in the past.
 */
describe("rental stats, upcoming and reminders", () => {
  let cookie: string;
  let userId: string;
  let betaBefore: boolean;

  const H = 3_600_000;
  const station = (country = "DE") => ({
    pickupStationName: "Testport",
    pickupLat: 50.03,
    pickupLon: 8.57,
    pickupCountry: country,
    pickupTimezone: "Europe/Berlin",
    returnStationName: "Testport",
    returnLat: 50.03,
    returnLon: 8.57,
    returnCountry: country,
    returnTimezone: "Europe/Berlin",
  });
  const rental = (over: Record<string, unknown>) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Testcar",
        ...station(),
        pickupTime: new Date("2025-05-05T08:00:00Z"),
        returnTime: new Date("2025-05-07T08:00:00Z"),
        status: "completed",
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalstats" } });
    const user = await prisma.user.create({
      data: { username: "rentalstats", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: ["flight", "rental"], data: {} },
      update: { enabledDomains: ["flight", "rental"] },
    });
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("counts completed rentals and their days, ranks providers by days, keeps brokers apart", async () => {
    await rental({ provider: "Alpha", price: 100, currency: "EUR" });
    await rental({
      provider: "Beta",
      broker: "Middleman",
      returnTime: new Date("2025-05-10T08:00:00Z"),
      price: 50,
      currency: "USD",
    });
    await rental({ provider: "Gamma", status: "cancelled" });
    const res = await request(app).get("/api/v1/rentals/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      rentals: 2,
      days: 7,
      providers: [
        { provider: "Beta", rentals: 1, days: 5 },
        { provider: "Alpha", rentals: 1, days: 2 },
      ],
      brokers: [{ broker: "Middleman", rentals: 1 }],
      countries: ["DE"],
    });
    expect(res.body.data.costPerDay).toEqual(
      expect.arrayContaining([
        { currency: "EUR", perDay: 50, rentals: 1, days: 2 },
        { currency: "USD", perDay: 10, rentals: 1, days: 5 },
      ])
    );
  });

  it("sums km only where an invoice gave them and says how many rentals that is — never 0 for unknown", async () => {
    await rental({});
    let res = await request(app).get("/api/v1/rentals/stats").set("Cookie", cookie);
    expect(res.body.data.km).toEqual({ total: null, covered: 0, of: 1 });
    await rental({ distanceKm: 300, distanceSource: "invoice" });
    res = await request(app).get("/api/v1/rentals/stats").set("Cookie", cookie);
    expect(res.body.data.km).toEqual({ total: 300, covered: 1, of: 2 });
  });

  it("leaves a price-less rental out of the cost per day instead of counting it at 0", async () => {
    await rental({ price: 100, currency: "EUR" });
    await rental({ paymentTiming: "package" });
    const res = await request(app).get("/api/v1/rentals/stats").set("Cookie", cookie);
    expect(res.body.data.costPerDay).toEqual([
      { currency: "EUR", perDay: 50, rentals: 1, days: 2 },
    ]);
  });

  it("names the next pickup in the upcoming feed, on the instance's beta switch", async () => {
    const now = Date.now();
    await rental({
      status: "scheduled",
      pickupTime: new Date(now + 48 * H),
      returnTime: new Date(now + 96 * H),
      provider: "Nextcar",
    });
    // The flag is shared instance state: whatever happens here, it goes back
    // to what it was before this test, not only at the end of the suite.
    const before = (await getInstanceSettings()).betaFeaturesEnabled;
    try {
      await updateInstanceSettings({ betaFeaturesEnabled: true });
      let res = await request(app).get("/api/v1/upcoming").set("Cookie", cookie);
      const entry = res.body.data.entries.find((e: { domain: string }) => e.domain === "rental");
      expect(entry).toMatchObject({ primary: "Nextcar · Testport" });
      await updateInstanceSettings({ betaFeaturesEnabled: false });
      res = await request(app).get("/api/v1/upcoming").set("Cookie", cookie);
      expect(
        res.body.data.entries.find((e: { domain: string }) => e.domain === "rental")
      ).toBeUndefined();
    } finally {
      await updateInstanceSettings({ betaFeaturesEnabled: before });
    }
  });

  it("reminds about a recently returned rental without km, and not about one with them", async () => {
    const now = Date.now();
    const missing = await rental({
      pickupTime: new Date(now - 72 * H),
      returnTime: new Date(now - 24 * H),
    });
    await rental({
      pickupTime: new Date(now - 72 * H),
      returnTime: new Date(now - 24 * H),
      distanceKm: 120,
      distanceSource: "invoice",
    });
    await rental({
      pickupTime: new Date(now - 300 * 24 * H),
      returnTime: new Date(now - 299 * 24 * H),
    });
    const res = await request(app).get("/api/v1/rentals/invoice-reminders").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { rentalId: string }) => r.rentalId)).toEqual([missing.id]);
    expect(res.body.data[0]).toMatchObject({
      reason: "invoiceMissing",
      returnStationName: "Testport",
    });
  });
});

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
 * forgejo#265 — the year in review and the trophy case follow the beta
 * switch: a user whose only data is a rental has a story while rentals are
 * visible and none while they are hidden; a shared badge only a beta domain
 * can earn is listed only while such a domain is.
 */
describe("wrapped and badges across domains", () => {
  const username = "wrapped-domains";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rental", "rail"], data: {} },
    });
    await prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        pickupStationName: "Lisboa",
        pickupLat: 38.77,
        pickupLon: -9.13,
        pickupTimezone: "Europe/Lisbon",
        returnStationName: "Lisboa",
        returnLat: 38.77,
        returnLon: -9.13,
        returnTimezone: "Europe/Lisbon",
        pickupTime: new Date("2024-04-01T09:00:00Z"),
        returnTime: new Date("2024-04-05T09:00:00Z"),
        status: "completed",
      },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  const wrapped = () => request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);

  it("tells a rental-only year while rentals are visible", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const res = await wrapped();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2024,
      availableYears: [2024],
      flights: 0,
      chapters: { rentals: { rentals: 1, days: 4 }, bus: null, lodging: null },
    });
  });

  it("has no story at all while the rental domain is behind the switch", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect((await wrapped()).status).toBe(404);
  });

  it("lists 'Ankommen und entdecken' only while rail or bus is visible", async () => {
    const codes = async (): Promise<string[]> =>
      (await request(app).get("/api/v1/achievements").set("Cookie", cookie)).body.achievements.map(
        (a: { code: string }) => a.code
      );
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const off = await codes();
    expect(off).not.toContain("TRIP_ARRIVE_DISCOVER");
    expect(off).not.toContain("RENTAL_FIRST");
    expect(off).toContain("DOCUMENTED_TRIP_1");
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const on = await codes();
    expect(on).toContain("TRIP_ARRIVE_DISCOVER");
    expect(on).toContain("RENTAL_FIRST");
    // Bus is not one of this user's domains: its badges stay out.
    expect(on).not.toContain("BUS_FIRST");
  });

  // forgejo#265: with flights switched off, a flight's year leaves the picker.
  it("offers no flight year once flights are switched off", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 38.7742,
        arrLon: -9.1342,
        departureTime: new Date("2022-06-01T08:00:00Z"),
        arrivalTime: new Date("2022-06-01T11:00:00Z"),
        status: "flown",
      },
    });
    expect((await wrapped()).body.availableYears).toEqual([2022, 2024]);
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["rental", "rail"] },
    });
    const off = await wrapped();
    expect(off.body.availableYears).toEqual([2024]);
    expect(off.body.flights).toBe(0);
  });

  // Review M1: "new countries" follow the same gate — a hidden domain proves none.
  it("counts no new country from a hidden domain", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.railJourney.create({
      data: {
        userId,
        status: "completed",
        depStationName: "Lisboa Oriente",
        depLat: 38.768,
        depLon: -9.099,
        depCountry: "PT",
        depTimezone: "Europe/Lisbon",
        arrStationName: "Vigo Guixar",
        arrLat: 42.235,
        arrLon: -8.713,
        arrCountry: "ES",
        arrTimezone: "Europe/Madrid",
        departureTime: new Date("2024-04-02T09:00:00Z"),
        arrivalTime: new Date("2024-04-02T15:00:00Z"),
      },
    });
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["rental", "rail"] },
    });
    const withRail = await request(app)
      .get("/api/v1/stats/wrapped?year=2024")
      .set("Cookie", cookie);
    expect(withRail.body.newCountries).toBe(2);
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["rental"] } });
    const hidden = await request(app).get("/api/v1/stats/wrapped?year=2024").set("Cookie", cookie);
    expect(hidden.body.newCountries).toBe(0);
  });
});

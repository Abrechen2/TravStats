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
});

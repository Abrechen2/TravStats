import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { searchableDomains } from "../../services/search/globalSearch";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * tours-own-domain T1: no account with tours ends without `tour` enabled — the
 * server's gates (sync, calendar, badges, search) read the user's domain list,
 * so a tour made by an account without the key would be invisible everywhere.
 */
describe("making a tour enables the tour domain", () => {
  const username = "tours-enable-domain";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  const domains = async (): Promise<string[] | undefined> =>
    (await prisma.userSettings.findUnique({ where: { userId } }))?.enabledDomains;

  it("creates the settings row with tour for an account that has none (POST /tours)", async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Erste", mode: "foot" })
      .expect(201);
    expect(await domains()).toEqual(["flight", "tour"]);
  });

  it("appends tour to an existing list and keeps the rest (POST /tours)", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "cruise"] },
    });
    await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Zweite", mode: "foot" })
      .expect(201);
    expect(await domains()).toEqual(["flight", "cruise", "tour"]);
  });

  it("does the same for a section made on a trip (POST /trips/:id/routes)", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    const trip = await prisma.trip.create({ data: { userId, name: "Reise" } });
    await request(app)
      .post(`/api/v1/trips/${trip.id}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Tag 1", mode: "foot" })
      .expect(201);
    expect(await domains()).toEqual(["flight", "tour"]);
  });

  it("global search offers tours only while the domain is on", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    expect(await searchableDomains(userId)).not.toContain("tour");
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "tour"] },
    });
    expect(await searchableDomains(userId)).toContain("tour");
  });
});

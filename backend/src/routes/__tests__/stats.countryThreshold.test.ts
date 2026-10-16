import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ensureAchievements } from "../../data/achievements";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#299 over a real request: the threshold setting is gone, replaced by
 * two named numbers — "Am Boden gewesen" (`groundCountries`) and "Land
 * besucht" (`visitedCountries`). A legacy value still stored on the instance
 * or the user must move neither number nor any row, and the countries badge
 * must count exactly the visited set, places included.
 *
 * The fixture has something on every side of the rule, so no assertion can
 * pass on an empty set: MUC -> DOH -> SIN and back (Singapore visited, Qatar
 * a decided connection, Germany an open chain end since the user has no home
 * period) plus a confirmed place visit in Spain.
 */
describe("GET /api/v1/stats/passport — legacy thresholds change nothing (forgejo#299)", () => {
  let user: { id: string };
  let authCookie: string;
  let adminSettingsId: number;
  let originalInstance: string;

  const setInstance = (tier: string) =>
    prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: { countryThreshold: tier },
    });

  const setUser = (tier: string | null) =>
    prisma.userSettings.update({ where: { userId: user.id }, data: { countryThreshold: tier } });

  type Body = {
    summary: {
      countries: number;
      groundCountries: number;
      visitedCountries: number;
      unclearCountries: number;
      countryThreshold: string;
    };
    countries: Array<{ code: string; tier: string; visited: boolean; visitUncertain: boolean }>;
  };
  const passport = async (): Promise<Body> => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    return res.body as Body;
  };

  beforeAll(async () => {
    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "DOH", "SIN"] } },
      select: { iata: true, country: true, lat: true, lon: true },
    });
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    // A missing catalogue is a broken test database, not a reason to pass.
    expect(["MUC", "DOH", "SIN"].filter((c) => !byIata.get(c)?.country)).toEqual([]);

    const row =
      (await prisma.adminSettings.findFirst()) ?? (await prisma.adminSettings.create({ data: {} }));
    adminSettingsId = row.id;
    originalInstance = row.countryThreshold;

    user = await prisma.user.create({
      data: {
        username: `threshold-passport-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId: user.id, data: {} } });

    const leg = (dep: string, arr: string, at: string) => {
      const d = byIata.get(dep)!;
      const a = byIata.get(arr)!;
      return prisma.flight.create({
        data: {
          userId: user.id,
          depIata: dep,
          depLat: d.lat,
          depLon: d.lon,
          arrIata: arr,
          arrLat: a.lat,
          arrLon: a.lon,
          departureTime: new Date(at),
          status: "flown",
        },
      });
    };
    await leg("MUC", "DOH", "2024-03-01T06:00:00Z");
    await leg("DOH", "SIN", "2024-03-01T16:00:00Z");
    await leg("SIN", "DOH", "2024-03-10T06:00:00Z");
    await leg("DOH", "MUC", "2024-03-10T16:00:00Z");
    await prisma.place.create({
      data: {
        userId: user.id,
        name: "Sagrada Familia",
        lat: 41.4,
        lon: 2.17,
        isoCountryCode: "ES",
        visited: true,
      },
    });

    // ensureAchievements upserts every definition one by one, which alone
    // measured close to five seconds — past jest's default hook timeout.
    await ensureAchievements();
  }, 30_000);

  afterEach(async () => {
    // The AdminSettings row is a singleton the whole suite shares.
    await setInstance(originalInstance);
    await setUser(null);
  });

  afterAll(async () => {
    await prisma.userAchievement.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("publishes the two numbers the rule produces", async () => {
    const p = await passport();

    expect(p.summary).toMatchObject({
      groundCountries: 4, // DE, QA, SG, ES
      visitedCountries: 2, // SG (out and back), ES (place)
      countries: 2,
      unclearCountries: 1, // DE: first departure and last arrival on record
      countryThreshold: "visited",
    });
    expect(p.countries.find((c) => c.code === "QA")).toMatchObject({
      tier: "connection",
      visited: false,
      visitUncertain: false,
    });
  });

  it("returns the identical body whatever legacy threshold the instance or user holds", async () => {
    const baseline = JSON.stringify(await passport());

    for (const tier of ["connection", "transited", "slept"] as const) {
      await setInstance(tier);
      await setUser(null);
      expect(JSON.stringify(await passport())).toBe(baseline);
      await setUser(tier === "slept" ? "connection" : "slept");
      expect(JSON.stringify(await passport())).toBe(baseline);
    }
  });

  it("counts the countries badge from the same visited set, the place included", async () => {
    for (const tier of ["connection", "slept"] as const) {
      await setUser(tier);

      await checkAndUpdateAchievements(user.id);
      const badge = await prisma.userAchievement.findFirst({
        where: { userId: user.id, achievement: { code: "COUNTRIES_10" } },
        select: { progress: true },
      });

      // `requirementType: 'countries'` stores the size of the counted set as
      // its progress, so this IS the badge figure.
      expect(badge?.progress).toBe(2);
      expect((await passport()).summary.visitedCountries).toBe(2);
    }
  });
});

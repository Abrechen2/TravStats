import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ensureAchievements } from "../../data/achievements";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The counting threshold, over a real request — spec §3.2, step 7.
 *
 * The derivation is pinned by unit tests (`passport.tiers.test.ts`) and the
 * resolution order by `countryThresholdResolver.test.ts`. What only a live
 * request can prove is the wiring in between: that `/stats/passport` publishes
 * the RESOLVED value rather than a module constant, that a user's own choice
 * actually reaches the fold, and that the badge count resolves the SAME tier —
 * a passport counting from one tier while the achievements count from another
 * is the drift forgejo#42 was filed about, arriving from a new angle.
 *
 * The fixture is flights only, on purpose. The passport counts recorded places
 * and the badges deliberately do not (a pin is not a journey), so a place in
 * the fixture would make the two disagree for a reason that has nothing to do
 * with the threshold and would hide the thing being measured.
 */
describe("GET /api/v1/stats/passport — the counting threshold", () => {
  let user: { id: string };
  let authCookie: string;
  let adminSettingsId: number;
  let originalInstance: string;
  let catalogReady = false;

  const setInstance = (tier: string) =>
    prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: { countryThreshold: tier },
    });

  const setUser = (tier: string | null) =>
    prisma.userSettings.update({ where: { userId: user.id }, data: { countryThreshold: tier } });

  const passport = async () => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    return res.body as {
      summary: { countries: number; countriesTotal: number; countryThreshold: string };
      countries: Array<{ code: string; tier: string; counted: boolean }>;
    };
  };

  beforeAll(async () => {
    // MUC → DOH → SIN, both legs on the same UTC day at Doha: Qatar is a
    // connection and nothing else, Germany and Singapore are `visited`.
    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "DOH", "SIN"] } },
      select: { iata: true, country: true, lat: true, lon: true },
    });
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    catalogReady = ["MUC", "DOH", "SIN"].every((c) => Boolean(byIata.get(c)?.country));
    if (!catalogReady) return;

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

    await ensureAchievements();
  });

  afterEach(async () => {
    if (!catalogReady) return;
    // The AdminSettings row is a singleton the whole suite shares.
    await setInstance(originalInstance);
    await setUser(null);
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.userAchievement.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("publishes the RESOLVED threshold, not a constant", async () => {
    if (!catalogReady) return;
    await setInstance("slept");

    expect((await passport()).summary.countryThreshold).toBe("slept");
  });

  it("lets a user's own choice beat the instance default", async () => {
    if (!catalogReady) return;
    await setInstance("slept");
    await setUser("connection");

    const p = await passport();

    expect(p.summary.countryThreshold).toBe("connection");
    // Everything counts at the lowest rung, connection included.
    expect(p.summary.countries).toBe(p.summary.countriesTotal);
  });

  it("falls back to the instance default for a user who has not chosen", async () => {
    if (!catalogReady) return;
    await setInstance("connection");

    const p = await passport();

    expect(p.summary.countryThreshold).toBe("connection");
    expect(p.summary.countries).toBe(3); // DE, QA, SG
  });

  it("returns the identical country list at every threshold, moving only the headline", async () => {
    if (!catalogReady) return;

    const seen: Record<string, Awaited<ReturnType<typeof passport>>> = {};
    for (const tier of ["connection", "transited", "slept"] as const) {
      await setUser(tier);
      seen[tier] = await passport();
    }

    // The one field a threshold may touch, removed. Everything else — which
    // countries, in which order, with which tier, days and ground time — has to
    // be the same bytes at every setting.
    const rows = (p: Awaited<ReturnType<typeof passport>>) =>
      JSON.stringify(p.countries.map(({ counted: _counted, ...rest }) => rest));

    expect(rows(seen.transited)).toBe(rows(seen.connection));
    expect(rows(seen.slept)).toBe(rows(seen.connection));
    for (const tier of ["transited", "slept"] as const) {
      expect(seen[tier].summary.countriesTotal).toBe(seen.connection.summary.countriesTotal);
    }

    // And the headline does move, or the invariance above would be trivially
    // true because nothing was ever filtered.
    expect(seen.connection.summary.countries).toBe(3);
    expect(seen.transited.summary.countries).toBe(2);
    expect(seen.slept.summary.countries).toBe(0);

    // The connection is still IN the list at the strictest setting. A country
    // wrongly classed as a connection must stay visible to be corrected — that
    // is how the Bucharest hotel was found.
    const qa = seen.slept.countries.find((c) => c.code === "QA");
    expect(qa).toBeDefined();
    expect(qa?.tier).toBe("connection");
    expect(qa?.counted).toBe(false);
  });

  it("counts the same countries for the badges as for the passport, at every threshold", async () => {
    if (!catalogReady) return;

    for (const tier of ["connection", "transited", "slept"] as const) {
      await setUser(tier);

      await checkAndUpdateAchievements(user.id);
      const badge = await prisma.userAchievement.findFirst({
        where: { userId: user.id, achievement: { code: "COUNTRIES_10" } },
        select: { progress: true },
      });

      // `requirementType: 'countries'` stores the size of the counted set as
      // its progress, so this IS the badge figure. A passport of 2 handing out
      // a badge off a set of 3 is the drift the shared threshold ends.
      expect(badge?.progress).toBe((await passport()).summary.countries);
    }
  });
});

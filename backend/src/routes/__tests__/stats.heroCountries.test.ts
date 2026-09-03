import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The hero tile counts countries the way everything else does — spec §4.
 *
 * §4 lists six consumers of `shared/countryEvidence.ts` and warns what happens
 * if one of them is left out: "folding lodging in without unifying the rule
 * would create a fifth answer". The hero tile WAS that answer. It read
 * `airportStats.countryCount`, which counts the countries a flight touched, and
 * it kept reading it while the other five moved to the shared module.
 *
 * That is not a cosmetic split. `/stats/hero` backs the Companion's Start
 * board, and the Companion draws a passport on the next screen — so a single
 * account had two answers to "how many countries" a swipe apart, which is the
 * drift forgejo#42 was filed about.
 *
 * WHY THE THRESHOLD IS THE LEVER HERE. A test that only compared two numbers
 * on one fixture could pass by coincidence: countries lost to the tier cut and
 * countries gained from lodging can cancel out to the same total. The old field
 * is threshold-BLIND, so moving the setting is what separates the two
 * implementations beyond doubt — the shared rule follows it, an airport count
 * cannot. Before the fix this fixture answered 3 at every setting.
 */
describe("GET /api/v1/stats/hero — countries come from the shared rule", () => {
  let user: { id: string };
  let authCookie: string;
  let adminSettingsId: number;
  let originalInstance: string;
  let catalogReady = false;

  const setUser = (tier: string | null) =>
    prisma.userSettings.update({ where: { userId: user.id }, data: { countryThreshold: tier } });

  const hero = async () => {
    const res = await request(app).get("/api/v1/stats/hero").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    return res.body as { countries: number; airports: number; flights: number };
  };

  const passport = async () => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    return res.body as { summary: { countries: number; countriesTotal: number } };
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
        username: `hero-countries-${Date.now()}`,
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
  });

  afterEach(async () => {
    if (!catalogReady) return;
    // The AdminSettings row is a singleton the whole suite shares.
    await prisma.adminSettings.update({
      where: { id: adminSettingsId },
      data: { countryThreshold: originalInstance },
    });
    await setUser(null);
    await prisma.lodging.deleteMany({ where: { userId: user.id } });
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("answers exactly what the passport answers, at every threshold", async () => {
    if (!catalogReady) return;

    for (const tier of ["connection", "transited", "slept"] as const) {
      await setUser(tier);
      const [h, p] = [await hero(), await passport()];
      expect(h.countries).toBe(p.summary.countries);
    }
  });

  it("moves with the threshold, which an airport count cannot", async () => {
    if (!catalogReady) return;

    const at = async (tier: string) => {
      await setUser(tier);
      return (await hero()).countries;
    };

    // Every rung counts: Germany, Qatar, Singapore.
    expect(await at("connection")).toBe(3);
    // The default. Qatar was a connection under one calendar day and drops out
    // — this is the "too high" half of the owner's report.
    expect(await at("transited")).toBe(2);
    // Nobody slept anywhere in this fixture, so the honest answer is none.
    expect(await at("slept")).toBe(0);
  });

  it("counts a country reached without a flight", async () => {
    if (!catalogReady) return;
    // The "too low" half: a country reached by car and slept in, which no
    // airport ever saw. At the strictest threshold it is the ONLY thing that
    // counts, so the number cannot come from the flights.
    await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Albergo Test",
        isoCountryCode: "IT",
        visited: true,
        stays: {
          create: {
            userId: user.id,
            status: "completed",
            checkIn: new Date("2024-05-01T00:00:00Z"),
            checkOut: new Date("2024-05-04T00:00:00Z"),
          },
        },
      },
    });

    await setUser("slept");

    const h = await hero();
    expect(h.countries).toBe(1);
    expect(h.countries).toBe((await passport()).summary.countries);
  });

  it("still counts airports by airport, not by evidence", async () => {
    if (!catalogReady) return;
    // The tile has two fields and only one of them moved. `airports` is a
    // count of airports touched and has nothing to do with the country rule —
    // a fix that quietly changed it too would be a second bug.
    await setUser("slept");
    expect((await hero()).airports).toBe(3);
  });
});

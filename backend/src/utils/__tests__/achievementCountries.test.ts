import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { loadPassport } from "../../services/stats/passportLoader";
import { achievementCountries } from "../achievementCountries";
import { checkAndUpdateAchievements } from "../achievements";

/** Country badges share the passport visit rule, including confirmed places. */

const USER = "achievement-countries-evidence";
const d = (day: string): Date => new Date(`${day}T00:00:00Z`);

describe("achievementCountries — the passport's evidence, the gates' visibility", () => {
  let userId: string;
  let betaBefore: boolean;

  const enable = (domains: string[]) =>
    prisma.userSettings.update({ where: { userId }, data: { enabledDomains: domains } });

  /** A completed ride between two countries — each end is rail evidence. */
  const ride = (from: string, to: string, day: string) =>
    prisma.railJourney.create({
      data: {
        userId,
        status: "completed",
        depStationName: `${from} Hbf`,
        depLat: 50,
        depLon: 8,
        depCountry: from,
        depTimezone: "Europe/Berlin",
        arrStationName: `${to} Hbf`,
        arrLat: 47,
        arrLon: 8,
        arrCountry: to,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date(`${day}T07:00:00Z`),
        arrivalTime: new Date(`${day}T10:00:00Z`),
      },
    });

  /** A past roadtrip with one night on a pitch inland in Norway. */
  const roadtripToNorway = async () => {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    await prisma.tripStop.create({
      data: {
        title: "Dombås Rasteplass",
        lat: 62.07,
        lon: 9.12,
        startDate: d("2024-07-13"),
        endDate: d("2024-07-15"),
        routeId: route.id,
        routeOrderIdx: 0,
        overnight: true,
      },
    });
  };

  /** Two consecutive track days in a country — the track tier is `slept`. */
  const trackDays = (country: string, first: string, second: string) =>
    prisma.countryDay.createMany({
      data: [first, second].map((day) => ({
        userId,
        date: d(day),
        countryCode: country,
        source: "dawarich",
        pointCount: 1,
        airportPointCount: 0,
        spanKm: 0,
      })),
    });

  /** MUC -> DOH -> SIN on one day: Qatar is a flight `connection` only. */
  const connectThroughDoha = async () => {
    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "DOH", "SIN"] } },
      select: { iata: true, lat: true, lon: true },
    });
    const at = new Map(airports.map((a) => [a.iata, a]));
    expect([...at.keys()].sort()).toEqual(["DOH", "MUC", "SIN"]);
    const leg = (dep: string, arr: string, when: string) =>
      prisma.flight.create({
        data: {
          userId,
          depIata: dep,
          depLat: at.get(dep)!.lat,
          depLon: at.get(dep)!.lon,
          arrIata: arr,
          arrLat: at.get(arr)!.lat,
          arrLon: at.get(arr)!.lon,
          departureTime: new Date(when),
          status: "flown",
        },
      });
    await leg("MUC", "DOH", "2024-03-01T06:00:00Z");
    await leg("DOH", "SIN", "2024-03-01T16:00:00Z");
  };

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["flight", "rail", "roadtrip"] },
    });
  });

  beforeEach(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await enable(["flight", "rail", "roadtrip"]);
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    // Pinned: the connection test below is about a threshold that excludes a
    // connection, and the instance default is shared suite state.
    await prisma.userSettings.update({
      where: { userId },
      data: { countryThreshold: "transited" },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("does not infer a visit from a one-way train ride (an open chain)", async () => {
    await ride("DE", "CH", "2025-03-01");
    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual([]);
  });

  it("counts a country reached only on a roadtrip", async () => {
    await roadtripToNorway();
    expect([...(await achievementCountries(userId, new Set()))]).toEqual(["NO"]);
  });

  it("leaves rail and roadtrip evidence out while the instance's beta switch is off", async () => {
    await ride("DE", "CH", "2025-03-01");
    await roadtripToNorway();
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect([...(await achievementCountries(userId, new Set()))]).toEqual([]);
  });

  it("leaves a domain out that the user switched off", async () => {
    await ride("DE", "CH", "2025-03-01");
    await roadtripToNorway();
    await enable(["flight", "roadtrip"]);
    expect([...(await achievementCountries(userId, new Set()))]).toEqual(["NO"]);
  });

  it("does not bypass visit evidence with a legacy union floor", async () => {
    expect([...(await achievementCountries(userId, new Set(["PT"])))]).toEqual([]);
  });

  it("requires recorded visits for a country badge and never takes an unlock back", async () => {
    await ride("DE", "CH", "2025-03-01");
    await ride("CH", "IT", "2025-03-03");
    await ride("IT", "FR", "2025-03-05");
    await ride("FR", "BE", "2025-03-07");

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const hidden = await checkAndUpdateAchievements(userId);
    expect(hidden.map((a) => a.achievement.code)).not.toContain("COUNTRIES_5");

    await updateInstanceSettings({ betaFeaturesEnabled: true });
    // Train endpoints alone are ground contact. Confirm actual stays before
    // testing the independent monotonic-unlock contract.
    await prisma.lodging.createMany({
      data: ["DE", "CH", "IT", "FR", "BE"].map((isoCountryCode) => ({
        userId,
        name: isoCountryCode,
        isoCountryCode,
        visited: true,
      })),
    });
    const shown = await checkAndUpdateAchievements(userId);
    expect(shown.map((a) => a.achievement.code)).toContain("COUNTRIES_5");

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await checkAndUpdateAchievements(userId);
    const kept = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: "COUNTRIES_5" } },
    });
    expect(kept).not.toBeNull();
  });

  it("keeps track-only countries outside visits and in unconfirmed observations", async () => {
    for (const code of ["EE", "LV", "LT", "FI", "SE"])
      await trackDays(code, "2025-06-01", "2025-06-02");

    expect([...(await achievementCountries(userId, new Set()))]).toEqual([]);
    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((a) => a.achievement.code)).not.toContain("COUNTRIES_5");

    // Raw observations remain available without contributing to either count.
    const ee = (await loadPassport(userId)).countries.find((c) => c.code === "EE");
    expect(ee).toBeUndefined();
    expect((await loadPassport(userId)).unconfirmedCountries.map((c) => c.code)).toContain("EE");
  });

  it("does not let a track lift a flight connection over a threshold that excludes it", async () => {
    await connectThroughDoha();
    await trackDays("QA", "2024-03-01", "2024-03-02");

    const qaOnPassport = (await loadPassport(userId)).countries.find((c) => c.code === "QA");
    expect(qaOnPassport).toMatchObject({ tier: "connection", counted: false });

    const badges = await achievementCountries(userId, new Set());
    expect([...badges].sort()).toEqual([]);
  });

  it("counts a confirmed city visit during a stopover", async () => {
    await connectThroughDoha();
    await prisma.place.create({
      data: {
        userId,
        name: "Souq Waqif",
        lat: 25.29,
        lon: 51.53,
        isoCountryCode: "QA",
        visited: true,
      },
    });

    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["QA"]);
  });

  it("does not infer a visit from an incomplete flight chain", async () => {
    await connectThroughDoha();
    await trackDays("SG", "2024-03-01", "2024-03-02");

    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual([]);
  });
});

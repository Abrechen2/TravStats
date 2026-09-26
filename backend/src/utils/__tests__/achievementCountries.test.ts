import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { achievementCountries } from "../achievementCountries";
import { checkAndUpdateAchievements } from "../achievements";

/**
 * Owner decision 2026-09-26: the cross-domain country badges ("N Länder
 * bereist") count like the passport. A country reached only by train or only
 * on a roadtrip counts — while its beta gate is on, as everywhere else those
 * domains show — and the badge engine stays monotonic: an unlock is never
 * taken back because a gate went off.
 */

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
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("counts a country reached only by train", async () => {
    await ride("DE", "CH", "2025-03-01");
    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["CH", "DE"]);
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

  it("keeps the union floor: a country the passport never measured still counts", async () => {
    expect([...(await achievementCountries(userId, new Set(["PT"])))]).toEqual(["PT"]);
  });

  it("unlocks a country badge from train rides, and never takes it back", async () => {
    await ride("DE", "CH", "2025-03-01");
    await ride("CH", "IT", "2025-03-03");
    await ride("IT", "FR", "2025-03-05");
    await ride("FR", "BE", "2025-03-07");

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const hidden = await checkAndUpdateAchievements(userId);
    expect(hidden.map((a) => a.achievement.code)).not.toContain("COUNTRIES_5");

    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const shown = await checkAndUpdateAchievements(userId);
    expect(shown.map((a) => a.achievement.code)).toContain("COUNTRIES_5");

    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await checkAndUpdateAchievements(userId);
    const kept = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: "COUNTRIES_5" } },
    });
    expect(kept).not.toBeNull();
  });
});

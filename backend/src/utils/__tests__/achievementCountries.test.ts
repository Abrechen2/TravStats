import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { loadPassport } from "../../services/stats/passportLoader";
import { achievementCountries, achievementGeography } from "../achievementCountries";
import { checkAndUpdateAchievements } from "../achievements";

/**
 * Country and continent badges read the passport's GROUND-CONTACT set
 * (forgejo#299; owner ruling 2026-08-09, "count every country set foot in"):
 * every passport row, connections and open chain ends included. Raw location
 * history is never a row, so a single stray point earns nothing.
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

  it("counts both ends of a one-way train ride as ground contact", async () => {
    await ride("DE", "CH", "2025-03-01");
    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["CH", "DE"]);
  });

  it("counts a country reached only on a roadtrip", async () => {
    await roadtripToNorway();
    expect([...(await achievementCountries(userId, new Set()))]).toEqual(["NO"]);
  });

  it("leaves roadtrip evidence out while the instance's beta switch is off", async () => {
    // Rail left the beta registry; the roadtrip domain is still behind it.
    await ride("DE", "CH", "2025-03-01");
    await roadtripToNorway();
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["CH", "DE"]);
  });

  it("leaves a domain out that the user switched off", async () => {
    await ride("DE", "CH", "2025-03-01");
    await roadtripToNorway();
    await enable(["flight", "roadtrip"]);
    expect([...(await achievementCountries(userId, new Set()))]).toEqual(["NO"]);
  });

  it("does not bypass ground evidence with a legacy union floor", async () => {
    expect([...(await achievementCountries(userId, new Set(["PT"])))]).toEqual([]);
  });

  it("earns a country badge from ground contact alone and never takes an unlock back", async () => {
    await ride("DE", "CH", "2025-03-01");
    await ride("CH", "IT", "2025-03-03");
    await ride("IT", "FR", "2025-03-05");
    await ride("FR", "BE", "2025-03-07");

    await enable(["flight"]);
    const hidden = await checkAndUpdateAchievements(userId);
    expect(hidden.map((a) => a.achievement.code)).not.toContain("COUNTRIES_5");

    await enable(["flight", "rail", "roadtrip"]);
    // Train endpoints are ground contact, and ground contact is what the
    // country badge counts — no stay needed (forgejo#299).
    const shown = await checkAndUpdateAchievements(userId);
    expect(shown.map((a) => a.achievement.code)).toContain("COUNTRIES_5");

    await enable(["flight"]);
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

  it("counts a flight connection as ground contact, though not as a visit", async () => {
    await connectThroughDoha();

    const qaOnPassport = (await loadPassport(userId)).countries.find((c) => c.code === "QA");
    expect(qaOnPassport).toMatchObject({ tier: "connection", counted: false });

    const badges = await achievementCountries(userId, new Set());
    expect([...badges].sort()).toEqual(["DE", "QA", "SG"]);
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

    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["DE", "QA", "SG"]);
  });

  it("lets no location-history country into the set, however many days it has", async () => {
    await connectThroughDoha();
    await trackDays("SY", "2024-03-01", "2024-03-02");

    expect([...(await achievementCountries(userId, new Set()))]).not.toContain("SY");
  });

  it("reads the continents of the ground-contact rows", async () => {
    await connectThroughDoha();
    await trackDays("KE", "2024-03-01", "2024-03-02");

    const geography = await achievementGeography(userId);
    expect([...geography.continents].sort()).toEqual(["Asia", "Europe"]);
  });

  /** Flown legs between catalogue airports, at the airports' own coordinates. */
  const fly = async (legs: Array<[string, string, string]>) => {
    const codes = [...new Set(legs.flatMap(([dep, arr]) => [dep, arr]))];
    const airports = await prisma.airport.findMany({
      where: { iata: { in: codes }, isClosed: false },
      select: { iata: true, lat: true, lon: true },
    });
    const at = new Map(airports.map((a) => [a.iata, a]));
    expect([...at.keys()].sort()).toEqual([...codes].sort());
    for (const [dep, arr, when] of legs) {
      await prisma.flight.create({
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
    }
  };

  it("keeps Asia for a flight to Vladivostok after one to Moscow (one country, two continents)", async () => {
    await fly([
      ["MUC", "SVO", "2024-03-01T06:00:00Z"],
      ["SVO", "VVO", "2024-03-03T06:00:00Z"],
    ]);

    const geography = await achievementGeography(userId);
    expect([...geography.countries].sort()).toEqual(["DE", "RU"]);
    expect([...geography.continents].sort()).toEqual(["Asia", "Europe"]);
  });

  it("files a stay in Sharm el-Sheikh under Asia and one in Hurghada under Africa", async () => {
    await prisma.lodging.create({
      data: { userId, name: "Sinai", isoCountryCode: "EG", lat: 27.98, lon: 34.39, visited: true },
    });
    expect([...(await achievementGeography(userId)).continents]).toEqual(["Asia"]);

    await prisma.lodging.create({
      data: { userId, name: "Red Sea", isoCountryCode: "EG", lat: 27.18, lon: 33.8, visited: true },
    });
    expect([...(await achievementGeography(userId)).continents].sort()).toEqual(["Africa", "Asia"]);
  });

  it("keeps the continent of an airport whose country the catalogue does not know", async () => {
    await prisma.airport.deleteMany({ where: { iata: "QZX" } });
    await prisma.airport.create({
      data: { iata: "QZX", name: "Unplaced strip", country: null, lat: -15.8, lon: -47.9 },
    });
    try {
      await fly([["MUC", "QZX", "2024-03-01T06:00:00Z"]]);

      const geography = await achievementGeography(userId);
      // No country is invented for it; its continent is still ground contact.
      expect([...geography.countries]).toEqual(["DE"]);
      expect([...geography.continents].sort()).toEqual(["Europe", "South America"]);
    } finally {
      await prisma.airport.deleteMany({ where: { iata: "QZX" } });
    }
  });

  it("earns a continent badge from a house on a third continent, not from a stray point", async () => {
    await connectThroughDoha();
    await trackDays("BR", "2024-03-05", "2024-03-06");
    expect((await checkAndUpdateAchievements(userId)).map((a) => a.achievement.code)).not.toContain(
      "CONTINENTS_3"
    );

    // A night in Nairobi is ground contact in Africa. The continent badge used
    // to read airports and ports only, so a house never moved it.
    await prisma.lodging.create({
      data: { userId, name: "Nairobi", isoCountryCode: "KE", visited: true },
    });
    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((a) => a.achievement.code)).toContain("CONTINENTS_3");
  });
});

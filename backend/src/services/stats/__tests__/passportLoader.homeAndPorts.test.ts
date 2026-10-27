import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import { getInstanceSettings, updateInstanceSettings } from "../../instanceSettingsService";
import { achievementCountries } from "../../../utils/achievementCountries";
import { loadCountryDetail } from "../countryDetailLoader";
import { loadPassport } from "../passportLoader";

/**
 * forgejo#299 through the real loaders, so the passport, the country page and
 * the countries badge are proven to apply ONE rule to the stored rows:
 *
 * - the home country (a home period that has begun) is "visited", even when
 *   every flight there is the end of an open chain;
 * - a cruise port call is a visit (owner ruling 2026-10-16), so a cruise-only
 *   account counts its port countries; a sea day proves nothing.
 */
const USER = "passport-loader-home-and-ports";

const homePeriod = (fromDate: string) => ({
  fromDate,
  toDate: null,
  residence: { name: "München", lat: 48.1374, lon: 11.5755 },
  residenceConfirmed: true,
  airports: [{ code: "MUC", primary: true }],
});

describe("loaders: home country and port calls (forgejo#299)", () => {
  let userId: string;
  let portIds: number[] = [];

  const setHome = (fromDate: string | null) =>
    prisma.userSettings.update({
      where: { userId },
      data: { data: fromDate ? { homePeriods: [homePeriod(fromDate)] } : {} },
    });

  /** MUC -> BKK, PNH -> MUC: an open-jaw trip, every end an open chain. */
  const openJaw = async () => {
    const airports = await prisma.airport.findMany({
      where: { iata: { in: ["MUC", "BKK", "PNH"] } },
      select: { iata: true, lat: true, lon: true },
    });
    const at = new Map(airports.map((a) => [a.iata, a]));
    expect([...at.keys()].sort()).toEqual(["BKK", "MUC", "PNH"]);
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
    await leg("MUC", "BKK", "2024-02-01T10:00:00Z");
    await leg("PNH", "MUC", "2024-02-20T10:00:00Z");
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["flight", "cruise"] },
    });
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.cruiseStop.deleteMany({ where: { cruise: { userId } } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.ferryJourney.deleteMany({ where: { userId } });
    portIds = [];
    await setHome(null);
  });

  afterAll(async () => {
    await prisma.cruiseStop.deleteMany({ where: { cruise: { userId } } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("counts the home country as visited on the passport, the country page and the badge", async () => {
    await openJaw();
    await setHome("2015-01-01");

    const passport = await loadPassport(userId);
    expect(passport.countries.find((c) => c.code === "DE")).toMatchObject({
      visited: true,
      isHome: true,
      visitUncertain: false,
    });
    // The open-jaw ends stay on the ground list as unclear, not dropped.
    for (const code of ["TH", "KH"]) {
      expect(passport.countries.find((c) => c.code === code)).toMatchObject({
        groundPresence: true,
        visited: false,
        visitUncertain: true,
        visitUncertainReasons: ["openChain"],
      });
    }
    expect(passport.summary).toMatchObject({
      groundCountries: 3,
      visitedCountries: 1,
      unclearCountries: 2,
    });
    expect(await loadCountryDetail(userId, "DE")).toMatchObject({ visited: true });
    // The badge counts ground contact (forgejo#299): the unclear ends too.
    expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["DE", "KH", "TH"]);
  });

  it("does not lift the home country for a home period that has not begun", async () => {
    await openJaw();
    await setHome("2099-01-01");

    const passport = await loadPassport(userId);
    expect(passport.countries.find((c) => c.code === "DE")).toMatchObject({
      visited: false,
      visitUncertain: true,
    });
  });

  it("counts a cruise-only account's port countries as visited, and no sea day", async () => {
    const port = await prisma.port.create({
      data: { name: "Geiranger test", country: "Norway", lat: 62.1, lon: 7.2, isUserAdded: true },
    });
    portIds = [port.id];
    await prisma.cruise.create({
      data: {
        userId,
        startDate: new Date("2023-07-01T00:00:00Z"),
        status: "completed",
        stops: {
          create: [
            { dayNumber: 1, isAtSea: true, date: new Date("2023-07-01T00:00:00Z") },
            { dayNumber: 2, portId: port.id, date: new Date("2023-07-02T00:00:00Z") },
          ],
        },
      },
    });

    const passport = await loadPassport(userId);
    expect(passport.summary).toMatchObject({ groundCountries: 1, visitedCountries: 1 });
    expect(passport.countries.find((c) => c.code === "NO")).toMatchObject({ visited: true });
    expect(await loadCountryDetail(userId, "NO")).toMatchObject({ visited: true });
    expect([...(await achievementCountries(userId, new Set()))]).toEqual(["NO"]);
  });

  /** Kiel -> Göteborg and back: a ferry round trip (owner ruling 2026-10-16 #3). */
  const ferryRoundTrip = async () => {
    const crossing = (from: [string, string, string], to: [string, string, string], at: string) =>
      prisma.ferryJourney.create({
        data: {
          userId,
          status: "completed",
          depStationName: from[0],
          depLat: 54.3,
          depLon: 10.1,
          depCountry: from[1],
          depTimezone: from[2],
          arrStationName: to[0],
          arrLat: 57.7,
          arrLon: 11.9,
          arrCountry: to[1],
          arrTimezone: to[2],
          departureTime: new Date(at),
          arrivalTime: new Date(new Date(at).getTime() + 14 * 3_600_000),
        },
      });
    const kiel: [string, string, string] = ["Kiel", "DE", "Europe/Berlin"];
    const goeteborg: [string, string, string] = ["Göteborg", "SE", "Europe/Stockholm"];
    await crossing(kiel, goeteborg, "2025-07-01T17:00:00Z");
    await crossing(goeteborg, kiel, "2025-07-08T17:00:00Z");
  };

  it("counts a ferry round trip on the passport, the country page and the badge while ferry is visible", async () => {
    const betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    try {
      await updateInstanceSettings({ betaFeaturesEnabled: true });
      await prisma.userSettings.update({
        where: { userId },
        data: { enabledDomains: ["flight", "cruise", "ferry"] },
      });
      await ferryRoundTrip();

      const passport = await loadPassport(userId);
      expect(passport.countries.find((c) => c.code === "SE")).toMatchObject({
        visited: true,
        kinds: ["ferry"],
        visitSources: [{ domain: "ferry", years: [2025], undated: false }],
      });
      expect(await loadCountryDetail(userId, "SE")).toMatchObject({
        visited: true,
        evidence: "ferry",
        ferryCrossings: 2,
      });
      // Ground contact: the home end of the crossing counts for the badge too.
      expect([...(await achievementCountries(userId, new Set()))].sort()).toEqual(["DE", "SE"]);

      // Hidden: the crossings prove nothing anywhere.
      await prisma.userSettings.update({
        where: { userId },
        data: { enabledDomains: ["flight", "cruise"] },
      });
      expect((await loadPassport(userId)).countries.map((c) => c.code)).toEqual([]);
      expect([...(await achievementCountries(userId, new Set()))]).toEqual([]);
    } finally {
      await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
      await prisma.userSettings.update({
        where: { userId },
        data: { enabledDomains: ["flight", "cruise"] },
      });
    }
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../../db";
import type { EvidenceScope } from "../../../../shared/evidence";
import { badgeProofKey } from "../../../../shared/badgeEvidence";
import { getInstanceSettings, updateInstanceSettings } from "../../../instanceSettingsService";
import { resolveMetricEvidence } from "../../metricEvidence";

/**
 * The countries badge's EVIDENCE must list the records its count was made from
 * (`utils/achievementCountries.ts`): a confirmed place visit (forgejo#299) and
 * no ride of a domain the user cannot see. It read the passport page's sources
 * instead, so a hidden train ride stood as proof of a badge it never counted
 * towards.
 */
const USER = "badge-evidence-countries";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 500 };

describe("countries badge evidence reads the badge's own sources", () => {
  let userId: string;
  let betaBefore: boolean;

  const evidence = async () => {
    const res = await resolveMetricEvidence(userId, badgeProofKey("countries"), ALL, PAGE);
    if (!res) throw new Error("countries badge evidence is not served");
    return res;
  };

  const houseIn = (isoCountryCode: string) =>
    prisma.lodging.create({
      data: { userId, name: `House ${isoCountryCode}`, isoCountryCode, visited: true },
    });

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["flight", "lodging", "rail", "place"] },
    });
  });

  beforeEach(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging", "rail", "place"] },
    });
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  // Rail left beta in 2.7.0-rc.20: the user's switch hides it, not the instance's.
  it("lists no train ride while the user has the rail domain off", async () => {
    await houseIn("DE");
    await prisma.railJourney.create({
      data: {
        userId,
        status: "completed",
        depStationName: "Frankfurt Hbf",
        depLat: 50.1,
        depLon: 8.66,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "Basel SBB",
        arrLat: 47.55,
        arrLon: 7.59,
        arrCountry: "CH",
        arrTimezone: "Europe/Zurich",
        departureTime: new Date("2025-03-01T07:00:00Z"),
        arrivalTime: new Date("2025-03-01T10:00:00Z"),
      },
    });
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging", "place"] },
    });

    const res = await evidence();

    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => [e.domain, e.credits])).toEqual([["lodging", ["DE"]]]);
  });

  it("counts and lists a confirmed place visit (forgejo#299), leaving nothing unexplained", async () => {
    await houseIn("DE");
    await prisma.place.create({
      data: {
        userId,
        name: "Sagrada Familia",
        lat: 41.4,
        lon: 2.17,
        isoCountryCode: "ES",
        visited: true,
      },
    });

    const res = await evidence();

    expect(res.measure.value).toBe(2);
    expect(res.entries.map((e) => [e.domain, e.credits]).sort()).toEqual([
      ["lodging", ["DE"]],
      ["place", ["ES"]],
    ]);
    expect(res.unattributed).toEqual([]);
  });

  it("lists a rest-stop place as ground contact for the badge (forgejo#299)", async () => {
    // A service area is ground contact, not a visit: the passport keeps it out
    // of "Land besucht", the badge, which counts ground contact, keeps it in.
    await prisma.place.create({
      data: {
        userId,
        name: "Raststätte Irschenberg",
        category: "service_area",
        lat: 47.83,
        lon: 11.92,
        isoCountryCode: "AT",
        visited: true,
      },
    });

    const res = await evidence();

    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => [e.domain, e.credits])).toEqual([["place", ["AT"]]]);
  });

  it("lists the continent of every ground-contact record for the continent badge", async () => {
    await houseIn("DE");
    await houseIn("KE");

    const res = await resolveMetricEvidence(userId, badgeProofKey("continents"), ALL, PAGE);
    if (!res) throw new Error("continents badge evidence is not served");

    expect(res.measure).toMatchObject({ aggregation: "distinct", unit: "continents", value: 2 });
    expect(res.entries.map((e) => e.credits).sort()).toEqual([["Africa"], ["Europe"]]);
    expect(res.unattributed).toEqual([]);
  });
});

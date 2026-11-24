import { prisma } from "../../../db";
import type { EvidenceScope } from "../../../shared/evidence";
import { loadYearStats } from "../../stats/yearStats/loadYearStats";
import { resolveMetricEvidence } from "../metricEvidence";
import { assertSumInvariant } from "./invariants";

/**
 * rc.45: the "Jahre" section's "Strecke im Logbuch" opens the entries behind it — every
 * domain's rides with their own kilometres — and the panel's value is the section's own.
 */
const USER = "yearsloggedevidence";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 50 };
const round1 = (n: number): number => Math.round(n * 10) / 10;

describe("loggedDistanceKm evidence", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["flight", "rail", "bus"] },
    });
    const ride = {
      depLat: 53.55,
      depLon: 10.0,
      depTimezone: "Europe/Berlin",
      arrLat: 52.5,
      arrLon: 13.4,
      arrTimezone: "Europe/Berlin",
      status: "completed",
    };
    await prisma.railJourney.create({
      data: {
        ...ride,
        userId,
        depStationName: "Hamburg Hbf",
        arrStationName: "Berlin Hbf",
        departureTime: new Date("2024-03-01T07:00:00Z"),
        distanceKm: 288.4,
      },
    });
    await prisma.busJourney.create({
      data: {
        ...ride,
        userId,
        depStationName: "Hamburg ZOB",
        arrStationName: "Berlin ZOB",
        departureTime: new Date("2025-05-01T07:00:00Z"),
        arrivalTime: new Date("2025-05-01T10:00:00Z"),
        distanceKm: 255.2,
      },
    });
    // No measured distance: not listed, counted as abstained.
    await prisma.busJourney.create({
      data: {
        ...ride,
        userId,
        depStationName: "Berlin ZOB",
        arrStationName: "Praha Florenc",
        departureTime: new Date("2025-06-01T07:00:00Z"),
        arrivalTime: new Date("2025-06-01T12:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  const resolve = async (scope: EvidenceScope) => {
    const res = await resolveMetricEvidence(userId, "loggedDistanceKm", scope, PAGE);
    if (!res) throw new Error("loggedDistanceKm is not served");
    assertSumInvariant(res, round1);
    return res;
  };

  it("lists every domain's entries with their km, and its value is the section's total", async () => {
    const section = await loadYearStats(userId);
    const res = await resolve(ALL);
    expect(res.measure.value).toBe(section.totals.loggedKm);
    expect(res.measure.value).toBe(543.6);
    expect(res.entries.map((e) => [e.domain, e.href, e.contribution])).toEqual(
      expect.arrayContaining([
        ["rail", expect.stringMatching(/^\/rail\//), 288.4],
        ["bus", expect.stringMatching(/^\/bus\//), 255.2],
      ])
    );
    expect(res.entries).toHaveLength(2);
    expect(res.entries.find((e) => e.domain === "rail")?.title).toEqual({
      text: "Hamburg Hbf → Berlin Hbf",
    });
  });

  it("narrows to one year: the year card's own distance", async () => {
    const section = await loadYearStats(userId);
    const y2025 = section.years.find((y) => y.year === 2025);
    const res = await resolve({ period: { kind: "year", year: 2025 } });
    expect(res.measure.value).toBe(y2025?.loggedKm);
    expect(res.entries.map((e) => e.domain)).toEqual(["bus"]);
    expect(res.entries[0].date).toEqual({ value: "2025-05-01", precision: "day" });
  });
});

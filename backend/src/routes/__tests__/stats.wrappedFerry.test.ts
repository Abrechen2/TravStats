import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";

/**
 * Ferry parity with rail and bus in the year in review: completed crossings
 * get a chapter of their own, filed under the departure port's year, and a
 * ferry domain the user switched off contributes no chapter and no year.
 */
describe("wrapped — the ferry chapter", () => {
  const username = "wrapped-ferry";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  const crossing = (over: Record<string, unknown>) => ({
    userId,
    operator: "Stena Line",
    depStationName: "Kiel Schwedenkai",
    depLat: 54.3167,
    depLon: 10.1394,
    depCountry: "DE",
    depTimezone: "Europe/Berlin",
    arrStationName: "Göteborg Stigberget",
    arrLat: 57.6995,
    arrLon: 11.9364,
    arrCountry: "SE",
    arrTimezone: "Europe/Stockholm",
    departureTime: new Date("2024-06-01T16:45:00Z"),
    arrivalTime: new Date("2024-06-02T07:15:00Z"),
    status: "completed",
    ...over,
  });

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "ferry"], data: {} },
    });
    await prisma.ferryJourney.createMany({
      data: [
        crossing({ distanceKm: 452.4 }),
        crossing({ distanceKm: null, departureTime: new Date("2024-08-01T10:00:00Z") }),
        // Planned and cancelled crossings never count.
        crossing({ status: "scheduled", distanceKm: 100 }),
        // 23:30 in Kiel on New Year's Eve is a crossing of the OLD year.
        crossing({
          distanceKm: 50,
          departureTime: new Date("2023-12-31T22:30:00Z"),
          arrivalTime: new Date("2024-01-01T08:00:00Z"),
        }),
      ],
    });
    // A flight keeps a story to tell once the ferry is hidden.
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 38.7742,
        arrLon: -9.1342,
        departureTime: new Date("2022-06-01T08:00:00Z"),
        arrivalTime: new Date("2022-06-01T11:00:00Z"),
        status: "flown",
      },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  const wrapped = (year?: number) =>
    request(app)
      .get(`/api/v1/stats/wrapped${year ? `?year=${year}` : ""}`)
      .set("Cookie", cookie);

  it("tells a ferry-only year while ferries are visible", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const res = await wrapped(2024);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2024,
      availableYears: [2022, 2023, 2024],
      chapters: { ferry: { crossings: 2, km: 452, unmeasured: 1 } },
    });
    expect((await wrapped(2023)).body.chapters.ferry).toEqual({
      crossings: 1,
      km: 50,
      unmeasured: 0,
    });
  });

  it("opens the crossings behind the ferry chapter", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const res = await resolveMetricEvidence(
      userId,
      "wrappedFerryCrossingCount",
      { period: { kind: "year", year: 2024 } },
      { offset: 0, limit: 50 }
    );
    expect(res?.measure.value).toBe(2);
    expect(res?.entries.map((e) => e.href)).toEqual([
      expect.stringMatching(/^\/ferry\//),
      expect.stringMatching(/^\/ferry\//),
    ]);
  });

  // Ferry left beta on 2026-10-26 (owner): the switch no longer hides a chapter.
  it("keeps the ferry chapter and its years with the beta switch off", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    const res = await wrapped(2024);
    expect(res.status).toBe(200);
    expect(res.body.chapters.ferry).toMatchObject({ crossings: 2 });
    expect(res.body.availableYears).toEqual([2022, 2023, 2024]);
    const evidence = await resolveMetricEvidence(
      userId,
      "wrappedFerryCrossingCount",
      { period: { kind: "year", year: 2024 } },
      { offset: 0, limit: 50 }
    );
    expect(evidence?.measure.value).toBe(2);
  });

  it("has no ferry chapter when the user switched ferries off", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight"] },
    });
    const res = await wrapped();
    expect(res.body.chapters.ferry).toBeNull();
    expect(res.body.availableYears).toEqual([2022]);
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "ferry"] },
    });
  });
});

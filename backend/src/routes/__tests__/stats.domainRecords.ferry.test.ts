import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";

/** The longest ferry crossing joins the domain records (ledger stats-coverage-remainders). */
describe("longest ferry crossing record", () => {
  const username = `ferry-record-${Date.now()}`;
  let userId: string;
  let cookie: string;
  let longestId: string;

  const crossing = (
    name: string,
    distanceKm: number | null,
    status: string
  ): ReturnType<typeof prisma.ferryJourney.create> =>
    prisma.ferryJourney.create({
      data: {
        userId,
        depStationName: name,
        depLat: 54,
        depLon: 10,
        arrStationName: `${name} Ziel`,
        arrLat: 55,
        arrLon: 11,
        departureTime: new Date("2025-06-01T08:00:00Z"),
        distanceKm,
        distanceSource: "route",
        status,
      },
    });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({ data: { username, passwordHash: await hashPassword("pw123456") } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "ferry"], data: {} },
    });
    await crossing("Kiel", 120, "completed");
    longestId = (await crossing("Rostock", 310.4, "completed")).id;
    // Planned: not a crossing yet. Unmeasured: ranks nowhere, never as 0 km.
    await crossing("Planned", 900, "scheduled");
    await crossing("Unmeasured", null, "completed");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const records = async (): Promise<Array<Record<string, unknown>>> =>
    (await request(app).get("/api/v1/stats/domain-records").set("Cookie", cookie)).body.records;

  it("names the longest completed measured crossing and skips planned ones", async () => {
    expect(await records()).toEqual([
      expect.objectContaining({
        domain: "ferry",
        id: "longest-ferry-crossing",
        value: 310,
        unit: "km",
        entryId: longestId,
        href: `/ferry/${longestId}`,
      }),
    ]);
  });

  it("opens the crossing that holds the record", async () => {
    const res = await resolveMetricEvidence(
      userId,
      "recordLongestFerryCrossing",
      { period: { kind: "allTime" } },
      { offset: 0, limit: 50 }
    );
    expect(res?.measure.value).toBe(310);
    expect(res?.entries).toEqual([expect.objectContaining({ id: longestId, domain: "ferry" })]);
  });

  it("has no record when no completed crossing has a distance", async () => {
    await prisma.ferryJourney.updateMany({ where: { userId }, data: { distanceKm: null } });
    expect(await records()).toEqual([]);
    const res = await resolveMetricEvidence(
      userId,
      "recordLongestFerryCrossing",
      { period: { kind: "allTime" } },
      { offset: 0, limit: 50 }
    );
    expect(res?.measure.value).toBeNull();
  });

  it("hides the record when the ferry domain is switched off", async () => {
    await prisma.ferryJourney.updateMany({ where: { id: longestId }, data: { distanceKm: 310 } });
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    expect(await records()).toEqual([]);
  });
});

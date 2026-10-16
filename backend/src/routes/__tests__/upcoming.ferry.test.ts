import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * Bus and rail were in "Als nächstes", ferry was not: the dashboard knew how
 * to draw and link a ferry entry, but /upcoming never named a crossing, so a
 * booked ferry tomorrow never showed as the next thing.
 */
describe("upcoming ferry crossings", () => {
  let userId: string;
  let beta: boolean;
  const now = new Date("2026-10-12T16:00:00Z");
  const get = () =>
    request(app)
      .get("/api/v1/upcoming")
      .set("Cookie", `auth_token=${generateToken(userId)}`);
  const crossing = (departure: string, extra: Record<string, unknown> = {}) => ({
    userId,
    operator: "Stena Line",
    vesselName: "Stena Germanica",
    depStationName: "Kiel",
    arrStationName: "Göteborg",
    depLat: 54.32,
    depLon: 10.14,
    arrLat: 57.7,
    arrLon: 11.94,
    departureTime: new Date(departure),
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Stockholm",
    depPrecision: "minute",
    ...extra,
  });
  beforeAll(async () => {
    beta = (await getInstanceSettings()).betaFeaturesEnabled;
    userId = (
      await prisma.user.create({ data: { username: "upcomingferry", passwordHash: "unused" } })
    ).id;
  });
  beforeEach(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: ["ferry"], data: {} },
      update: { enabledDomains: ["ferry"] },
    });
    jest.useFakeTimers({
      doNotFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask"],
    });
    jest.setSystemTime(now);
  });
  afterEach(async () => {
    jest.useRealTimers();
    await prisma.ferryJourney.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: beta });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("names the next crossing with its port clocks, skipping cancelled and departed ones", async () => {
    const next = await prisma.ferryJourney.create({ data: crossing("2026-10-13T17:00:00Z") });
    await prisma.ferryJourney.createMany({
      data: [
        crossing("2026-10-12T15:00:00Z"),
        crossing("2026-10-12T18:00:00Z", { status: "cancelled" }),
      ],
    });
    const res = await get();
    expect(res.status).toBe(200);
    const entry = res.body.data.entries.find((e: { domain: string }) => e.domain === "ferry");
    expect(entry).toMatchObject({
      id: next.id,
      detailId: next.id,
      startsAt: "2026-10-13T17:00:00.000Z",
      startsAtPrecision: "minute",
      primary: "Kiel → Göteborg",
      secondary: "Stena Line · Stena Germanica",
    });
    expect(entry.times.departure).toMatchObject({ zone: "Europe/Berlin" });
  });

  it("keeps a date-only crossing upcoming through its day and counts it by day", async () => {
    await prisma.ferryJourney.create({
      data: crossing("2026-10-11T22:00:00Z", { depPrecision: "day" }), // Oct 12 in Kiel.
    });
    const entry = (await get()).body.data.entries.find(
      (e: { domain: string }) => e.domain === "ferry"
    );
    expect(entry).toMatchObject({ startsAtPrecision: "day" });
  });

  it("says nothing about ferries while the domain is off", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    await prisma.ferryJourney.create({ data: crossing("2026-10-13T17:00:00Z") });
    const entries = (await get()).body.data.entries as Array<{ domain: string }>;
    expect(entries.some((e) => e.domain === "ferry")).toBe(false);
  });
});

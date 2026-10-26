import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

describe("upcoming buses (companion#62)", () => {
  let userId: string;
  let otherId: string;
  let beta: boolean;
  const now = new Date("2026-10-12T16:00:00Z"); // Oct 13 in Seoul; Oct 12 in Honolulu.
  const get = () =>
    request(app)
      .get("/api/v1/upcoming")
      .set("Cookie", `auth_token=${generateToken(userId)}`);
  const ride = (departure: string) => ({
    userId,
    operator: "Kobus",
    lineName: "Premium",
    depStationName: "Seoul",
    arrStationName: "Sokcho",
    depLat: 37.5,
    depLon: 127,
    arrLat: 38.19,
    arrLon: 128.59,
    departureTime: new Date(departure),
    depTimezone: "Asia/Seoul",
    arrTimezone: "Asia/Seoul",
    depPrecision: "minute",
  });
  beforeAll(async () => {
    beta = (await getInstanceSettings()).betaFeaturesEnabled;
    userId = (
      await prisma.user.create({ data: { username: "upcomingbus", passwordHash: "unused" } })
    ).id;
    otherId = (
      await prisma.user.create({ data: { username: "upcomingbusother", passwordHash: "unused" } })
    ).id;
  });
  beforeEach(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: ["bus"], data: {} },
      update: { enabledDomains: ["bus"] },
    });
    jest.useFakeTimers({
      doNotFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask"],
    });
    jest.setSystemTime(now);
  });
  afterEach(async () => {
    jest.useRealTimers();
    await prisma.busJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });
  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: beta });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });
  it("returns the earliest own future departure, terminal times and trip, ignoring cancelled and started rides", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Korea",
        startDate: new Date("2026-10-10"),
        endDate: new Date("2026-10-20"),
      },
    });
    const bus = await prisma.busJourney.create({
      data: { ...ride("2026-10-13T00:00:00Z"), tripId: trip.id },
    });
    await prisma.busJourney.createMany({
      data: [
        { ...ride("2026-10-12T17:00:00Z"), status: "cancelled" },
        { ...ride("2026-10-12T15:00:00Z"), status: "in_progress" },
        { ...ride("2026-10-12T18:00:00Z"), userId: otherId },
      ],
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual([
      expect.objectContaining({
        domain: "bus",
        id: bus.id,
        detailId: bus.id,
        primary: "Kobus · Seoul",
        secondary: "Premium · Sokcho",
        startsAtPrecision: "minute",
        tripId: trip.id,
        tripName: "Korea",
        times: expect.objectContaining({
          departure: expect.objectContaining({ zone: "Asia/Seoul", local: "2026-10-13T09:00:00" }),
        }),
      }),
    ]);
  });
  it("honours the user's domain switch", async () => {
    await prisma.busJourney.create({ data: ride("2026-10-13T00:00:00Z") });
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: [] } });
    expect((await get()).body.data.entries).toEqual([]);
  });
  // Bus left beta on 2026-10-26 (owner): the instance's switch hides nothing.
  it("lists the ride with the instance's beta switch off", async () => {
    await prisma.busJourney.create({ data: ride("2026-10-13T00:00:00Z") });
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect((await get()).body.data.entries.map((e: { domain: string }) => e.domain)).toContain(
      "bus"
    );
  });
  it("keeps an open ticket until its terminal day ends, without claiming a clock", async () => {
    const bus = await prisma.busJourney.create({
      data: {
        ...ride("2026-10-12T10:00:00Z"),
        depTimezone: "Pacific/Honolulu",
        depPrecision: "day",
      },
    });
    expect((await get()).body.data.entries[0]).toMatchObject({
      id: bus.id,
      startsAtPrecision: "day",
      times: { departure: { precision: "day", zone: "Pacific/Honolulu" } },
    });
    jest.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    expect((await get()).body.data.entries).toEqual([]);
  });
  it("does not let a page of expired open tickets hide the next bus", async () => {
    await prisma.busJourney.createMany({
      data: Array.from({ length: 55 }, () => ({
        ...ride("2026-10-11T15:00:00Z"),
        depPrecision: "day",
      })),
    });
    const bus = await prisma.busJourney.create({ data: ride("2026-10-13T00:00:00Z") });
    expect((await get()).body.data.entries[0].id).toBe(bus.id);
  });
});

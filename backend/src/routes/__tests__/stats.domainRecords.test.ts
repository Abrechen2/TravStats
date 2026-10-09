import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * GET /stats/domain-records (forgejo#265): one record per domain the user
 * sees, each in its own unit and linked to its entry; a hidden domain and a
 * domain with nothing measurable have none.
 */
describe("travel records beyond flights", () => {
  const username = `domain-records-${Date.now()}`;
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    userId = (
      await prisma.user.create({ data: { username, passwordHash: await hashPassword("pw123456") } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "lodging", "rail", "poi"], data: {} },
    });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Alpenblick", type: "hotel", lat: 47.4, lon: 11.1 },
    });
    await prisma.lodgingStay.createMany({
      data: [
        {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2024-02-01T00:00:00Z"),
          checkOut: new Date("2024-02-08T00:00:00Z"),
          datePrecision: "DAY",
          status: "completed",
        },
        {
          // Booked for next decade: not a stay yet, not a record.
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2099-02-01T00:00:00Z"),
          checkOut: new Date("2099-03-01T00:00:00Z"),
          datePrecision: "DAY",
          status: "scheduled",
        },
      ],
    });
    await prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Wien Hbf",
        depLat: 48.185,
        depLon: 16.376,
        arrStationName: "Hamburg Hbf",
        arrLat: 53.553,
        arrLon: 10.007,
        departureTime: new Date("2025-03-01T20:00:00Z"),
        arrivalTime: new Date("2025-03-02T08:00:00Z"),
        distanceKm: 1100.4,
        distanceSource: "great_circle",
        status: "completed",
      },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const records = async () =>
    (await request(app).get("/api/v1/stats/domain-records").set("Cookie", cookie)).body.records;

  it("names the longest stay and train ride, each in its own unit, with a link", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const list = await records();
    expect(list).toEqual([
      expect.objectContaining({
        domain: "lodging",
        id: "longest-stay",
        value: 7,
        unit: "nights",
        label: "Hotel Alpenblick",
      }),
      expect.objectContaining({
        domain: "rail",
        id: "longest-rail-ride",
        value: 1100,
        unit: "km",
        distanceSource: "great_circle",
      }),
    ]);
    expect(list[1].href).toMatch(/^\/rail\//);
  });

  it("drops the train ride with the rail domain behind the beta switch", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect((await records()).map((r: { domain: string }) => r.domain)).toEqual(["lodging"]);
  });

  // Review I2: the longest roadtrip is the span its stations ATTEST — a planned
  // station ahead and a MONTH placeholder stay must not stretch it.
  it("measures the longest roadtrip over attested days only", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging", "rail", "poi", "roadtrip"] },
    });
    const DAY = 86_400_000;
    const dayOf = (offset: number): Date =>
      new Date(`${new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)}T00:00:00Z`);
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Norwegen", mode: "road", kind: "roadtrip" },
    });
    const stop = (order: number, startDate: Date | null, lodgingStayId: string | null = null) =>
      prisma.tripStop.create({
        data: {
          title: `S${order}`,
          lat: 60,
          lon: 10,
          routeId: route.id,
          routeOrderIdx: order,
          orderIdx: order,
          startDate,
          lodgingStayId,
        },
      });
    await stop(0, dayOf(-10));
    await stop(1, dayOf(-8));
    await stop(2, dayOf(30)); // planned — not a day travelled yet
    // A station whose only dates are a MONTH placeholder stay names no exact day.
    const house = await prisma.lodging.create({
      data: { userId, name: "Hytte", type: "cabin", lat: 60, lon: 10 },
    });
    const month = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: house.id,
        checkIn: new Date("2020-01-01T00:00:00Z"),
        checkOut: new Date("2020-01-31T00:00:00Z"),
        datePrecision: "MONTH",
        status: "completed",
      },
    });
    await stop(3, null, month.id);
    const roadtrip = (await records()).find((r: { domain: string }) => r.domain === "roadtrip");
    expect(roadtrip).toMatchObject({ id: "longest-roadtrip", value: 3, unit: "days" });
  });
});

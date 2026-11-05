import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { mockFetch, type FetchMock } from "../../services/openData/__tests__/fetchMock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A roadtrip station's weather is computed per request and stored nowhere, so
 * the only protection against "a busy weather service empties the page" is
 * the outcome: a service failure must be told apart from an answer about the
 * day. Open-Meteo is replaced in every test.
 */
const DAY = (day: string) => ({
  daily: {
    time: [day],
    weather_code: [53],
    temperature_2m_max: [17.7],
    temperature_2m_min: [10.9],
    precipitation_sum: [0.7],
  },
});

const USERS = ["stationweather", "stationweatherother"];

describe("GET /roadtrips/:id/stations/:stationId/weather", () => {
  let cookie: string;
  let otherCookie: string;
  let settingsId: number;
  let previousSwitch: boolean;
  let roadtripId: string;
  let pastId: string;
  let todayId: string;
  let unplacedId: string;
  let fetches: FetchMock | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousSwitch = settings.openDataEnabled;
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { openDataEnabled: true },
    });
    const route = await prisma.tripRoute.create({
      data: { userId: u.id, name: "Fjorde", kind: "roadtrip", mode: "drive" },
    });
    roadtripId = route.id;
    const stop = (title: string, startDate: Date | null, lat: number | null, order: number) =>
      prisma.tripStop.create({
        data: { routeId: route.id, title, lat, lon: lat === null ? null : 5.7, startDate, routeOrderIdx: order },
      });
    pastId = (await stop("Stavanger", new Date("2024-07-14T00:00:00Z"), 58.97, 0)).id;
    todayId = (
      await stop("Bergen", new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`), 60.4, 1)
    ).id;
    unplacedId = (await stop("Irgendwo", null, null, 2)).id;
  });

  afterEach(() => {
    fetches?.restore();
    fetches = null;
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { openDataEnabled: previousSwitch },
    });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  const get = (stationId: string, c = cookie) =>
    request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/stations/${stationId}/weather`)
      .set("Cookie", c);

  it("returns the measured weather of the arrival day", async () => {
    fetches = mockFetch([[/open-meteo\.com/, DAY("2024-07-14")]]);
    const res = await get(pastId);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("observed");
    expect(res.body.weather).toMatchObject({ code: 53, tMaxC: 17.7, day: "2024-07-14", lat: 58.97 });
  });

  it.each([
    [429, "rateLimited"],
    [504, "timeout"],
    [503, "unavailable"],
  ])("Open-Meteo %s is the outcome %s, not an empty weather", async (status, outcome) => {
    fetches = mockFetch([[/open-meteo\.com/, { error: true }, status]]);
    const res = await get(pastId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome, weather: null });
  });

  it("says 'not yet' for today without asking anyone, and 'no location' for an unplaced or undated station", async () => {
    fetches = mockFetch([]);
    expect((await get(todayId)).body.outcome).toBe("futureOrToday");
    expect((await get(unplacedId)).body.outcome).toBe("noLocation");
    expect(fetches.calls).toHaveLength(0);
  });

  it("is off with the instance's open data switch, and another account's station is a 404", async () => {
    expect((await get(pastId, otherCookie)).status).toBe(404);
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { openDataEnabled: false },
    });
    fetches = mockFetch([]);
    expect((await get(pastId)).body).toEqual({ outcome: "disabled", weather: null });
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { openDataEnabled: true },
    });
  });
});

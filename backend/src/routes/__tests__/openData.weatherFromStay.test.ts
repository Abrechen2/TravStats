import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { mockFetch, type FetchMock } from "../../services/openData/__tests__/fetchMock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Acceptance 2026-09-26: "Wetter nachtragen" said noLocation for a Barcelona
 * trip whose stay (Casa Mirador) carries coordinates — the day's place was
 * looked for among the trip's stops only, and this trip has none. A dated,
 * geocoded stay is where the night was spent, so it places the day.
 * `fetch` is replaced; nothing reaches Open-Meteo.
 */

describe("journal weather placed by the trip's stay", () => {
  let cookie: string;
  let userId: string;
  let settingsId: number;
  let previousSwitch: boolean;
  let fetches: FetchMock | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "weather-stay" } });
    const u = await prisma.user.create({
      data: { username: "weather-stay", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousSwitch = settings.openDataEnabled;
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { openDataEnabled: true },
    });
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
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("measures the day at the stay's hotel when the trip has no stops", async () => {
    fetches = mockFetch([
      [
        /open-meteo\.com/,
        {
          daily: {
            time: ["2024-05-11"],
            weather_code: [1],
            temperature_2m_max: [23.4],
            temperature_2m_min: [15.2],
            precipitation_sum: [0],
          },
        },
      ],
    ]);
    const trip = await prisma.trip.create({ data: { userId, name: "Barcelona" } });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Casa Mirador", city: "Barcelona", lat: 41.3874, lon: 2.1686 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId: trip.id,
        checkIn: new Date("2024-05-10T00:00:00Z"),
        checkOut: new Date("2024-05-13T00:00:00Z"),
      },
    });
    const entry = await prisma.tripJournalEntry.create({
      data: {
        tripId: trip.id,
        date: new Date("2024-05-11T00:00:00Z"),
        body: "Sagrada Família",
        observedWeather: Prisma.DbNull,
      },
    });

    const res = await request(app)
      .post(`/api/v1/trips/${trip.id}/journal/${entry.id}/weather`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.weatherOutcome).toBe("observed");
    expect(res.body.entry.observedWeather).toMatchObject({ place: "Casa Mirador", tMaxC: 23.4 });
    expect(fetches.calls[0]).toContain("latitude=41.3874");
  });
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { mockFetch, type FetchMock } from "../../services/openData/__tests__/fetchMock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A journal entry's weather survives a weather service that does not answer
 * (silent-failure fixes, 2026-09-26).
 *
 * Open-Meteo timing out, answering 429 or 5xx came back as the same null as
 * "no stop covers this day" — and the null was WRITTEN over the stored
 * weather, while the dialog said "no place with coordinates", also for an
 * entry dated today. Now a failure of the service keeps what is stored and
 * says which failure it was; only an answer about the day is written.
 * `fetch` is replaced in every test.
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

const STORED = {
  code: 3,
  tMaxC: 20,
  tMinC: 12,
  precipMm: 0,
  place: "Stavanger",
  lat: 58.97,
  lon: 5.73,
  source: "open-meteo",
  fetchedAt: "2026-01-01T00:00:00.000Z",
};

describe("journal weather is kept when the weather service fails", () => {
  let cookie: string;
  let userId: string;
  let settingsId: number;
  let previousSwitch: boolean;
  let fetches: FetchMock | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "weather-kept" } });
    const u = await prisma.user.create({
      data: { username: "weather-kept", passwordHash: await hashPassword("password123") },
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

  beforeEach(() => clearJobs());

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

  async function trip(): Promise<string> {
    const t = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    await prisma.tripStop.create({
      data: {
        tripId: t.id,
        title: "Stavanger",
        lat: 58.97,
        lon: 5.73,
        startDate: new Date("2024-07-14T00:00:00Z"),
        endDate: new Date("2024-07-16T00:00:00Z"),
      },
    });
    return t.id;
  }

  const entry = (tripId: string, date: string, withWeather = true) =>
    prisma.tripJournalEntry.create({
      data: {
        tripId,
        date: new Date(`${date}T00:00:00Z`),
        body: "x",
        observedWeather: withWeather ? (STORED as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

  it.each([
    [429, "rateLimited"],
    [504, "timeout"],
    [503, "unavailable"],
  ])("Open-Meteo %s keeps the stored weather and says %s", async (status, outcome) => {
    fetches = mockFetch([[/open-meteo\.com/, { error: true }, status]]);
    const tripId = await trip();
    const e = await entry(tripId, "2024-07-15");

    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/journal/${e.id}/weather`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.weatherOutcome).toBe(outcome);
    expect(res.body.entry.observedWeather).toMatchObject({ code: 3, tMaxC: 20 });
    const stored = await prisma.tripJournalEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(stored.observedWeather).toMatchObject({ code: 3 });
  });

  it("an entry dated today is 'not yet', not 'no place', and asks nobody", async () => {
    fetches = mockFetch([]);
    const tripId = await trip();
    const today = new Date().toISOString().slice(0, 10);
    await prisma.tripStop.create({
      data: {
        tripId,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        startDate: new Date(`${today}T00:00:00Z`),
      },
    });
    const e = await entry(tripId, today, false);

    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/journal/${e.id}/weather`)
      .set("Cookie", cookie);

    expect(res.body.weatherOutcome).toBe("futureOrToday");
    expect(fetches.calls).toHaveLength(0);
  });

  it("a moved date does not keep the old day's weather even when the lookup fails", async () => {
    fetches = mockFetch([[/open-meteo\.com/, { error: true }, 503]]);
    const tripId = await trip();
    const e = await entry(tripId, "2024-07-15");

    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/journal/${e.id}`)
      .set("Cookie", cookie)
      .send({ date: "2024-07-16" });

    expect(res.status).toBe(200);
    expect(res.body.weatherOutcome).toBe("unavailable");
    expect(res.body.entry.observedWeather).toBeNull();
  });

  it("the trip-wide fill runs as a job and reports each entry's outcome", async () => {
    fetches = mockFetch([
      [/start_date=2024-07-15/, DAY("2024-07-15")],
      [/start_date=2024-07-16/, { error: true }, 429],
    ]);
    const tripId = await trip();
    const nowhere = await entry(tripId, "2024-07-10", false);
    const good = await entry(tripId, "2024-07-15", false);
    const limited = await entry(tripId, "2024-07-16", false);

    const started = await request(app)
      .post(`/api/v1/trips/${tripId}/journal/weather`)
      .set("Cookie", cookie)
      .send({ background: true });
    expect(started.status).toBe(202);

    await settleAllJobs();
    const job = (await request(app).get(`/api/v1/jobs/${started.body.jobId}`).set("Cookie", cookie))
      .body.data;
    expect(job.status).toBe("succeeded");
    expect(job.result.filled).toBe(1);
    expect(job.result.outcomes).toEqual([
      { entryId: nowhere.id, date: "2024-07-10", outcome: "noLocation" },
      { entryId: good.id, date: "2024-07-15", outcome: "observed" },
      { entryId: limited.id, date: "2024-07-16", outcome: "rateLimited" },
    ]);
  });
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/day` (TravTrack plan T6): one day of the account's history
 * on the profile clock, its lines cut at every gap and privacy-cut, what the
 * phone did and did not record, and what TravStats knows of the day — the
 * flights, the trips and the stretches at home.
 */

const PREFIX = "travtrack-day-";
const MIN = 60_000;
// 12 Oct in Seoul (UTC+9) runs from 11 Oct 15:00Z to 12 Oct 15:00Z.
const DAY_START = Date.parse("2026-10-11T15:00:00Z");
const DAY_END = Date.parse("2026-10-12T15:00:00Z");
const HOME = { name: "Wohnung", lat: 37.55, lon: 126.99, zone: "Asia/Seoul" };

describe("TravTrack — the day view", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const day = (date = "2026-10-12") =>
    request(app).get("/api/v1/travtrack/day").query({ date }).set("Cookie", cookie);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } }, homePlace: HOME },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a day on the profile clock, with flights, trip and home as context", async () => {
    const flightId = await makeFlight(userId); // 00:30Z–01:30Z on 12 Oct
    const tripId = await makeTrip(userId); // 11–14 Oct in Seoul
    await storePoint(userId, { t: DAY_START - MIN, lat: 37.55, lon: 126.99 }); // the day before
    // The morning at home, then out into town.
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: DAY_START + i * 5 * MIN, lat: 37.5501, lon: 126.99 });
    }
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, {
        t: DAY_START + (20 + i * 5) * MIN,
        lat: 37.57 + i * 0.001,
        lon: 127,
      });
    }
    await storePoint(otherId, { t: DAY_START + 10 * MIN, lat: 35, lon: 129 });

    const res = await day();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: "2026-10-12", zone: "Asia/Seoul", pointCount: 6 });
    expect(res.body.segments.flat().map((p: number[]) => p[0])).toEqual([
      DAY_START,
      DAY_START + 5 * MIN,
      DAY_START + 10 * MIN,
      DAY_START + 20 * MIN,
      DAY_START + 25 * MIN,
      DAY_START + 30 * MIN,
    ]);
    const kinds = res.body.context.map((c: { kind: string; id: string | null }) => [c.kind, c.id]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["flight", flightId],
        ["trip", tripId],
        ["home", null],
      ])
    );
    const flight = res.body.context.find((c: { kind: string }) => c.kind === "flight");
    expect(flight.label).toContain("ICN");
    expect(flight.fromMs).toBe(Date.parse("2026-10-12T00:30:00Z"));
    const trip = res.body.context.find((c: { kind: string }) => c.kind === "trip");
    expect([trip.label, trip.fromMs, trip.untilMs]).toEqual(["Seoul", DAY_START, DAY_END]);
    const home = res.body.context.find((c: { kind: string }) => c.kind === "home");
    expect([home.label, home.fromMs, home.untilMs]).toEqual([
      "Wohnung",
      DAY_START,
      DAY_START + 10 * MIN,
    ]);
    // The day is covered end to end, recorded where the phone was.
    const coverage = res.body.coverage as Array<{ fromMs: number; untilMs: number; state: string }>;
    expect(coverage[0].fromMs).toBe(DAY_START);
    expect(coverage[coverage.length - 1].untilMs).toBe(DAY_END);
    expect(coverage).toContainEqual({
      fromMs: DAY_START,
      untilMs: DAY_START + 30 * MIN,
      state: "recorded",
    });
  });

  it("every label carries its link and map anchor; the way into town is unlabelled", async () => {
    const flightId = await makeFlight(userId); // ICN–CJU, 00:30Z–01:30Z on 12 Oct
    const tripId = await makeTrip(userId);
    // The morning at home, then 2 km into town without an entry for the way.
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: DAY_START + i * 5 * MIN, lat: 37.5501, lon: 126.99 });
    }
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: DAY_START + (20 + i * 5) * MIN, lat: 37.57, lon: 127 });
    }

    const res = await day();
    expect(res.status).toBe(200);
    const context = res.body.context as Array<Record<string, unknown>>;
    for (const entry of context) {
      expect(entry).toHaveProperty("href");
      expect(entry).toHaveProperty("anchor");
      expect(typeof entry.unlabelled).toBe("boolean");
    }
    expect(context.find((c) => c.kind === "flight")).toMatchObject({
      id: flightId,
      href: `/flights/${flightId}`,
      anchor: { lat: 37.469, lon: 126.451 },
    });
    expect(context.find((c) => c.kind === "trip")).toMatchObject({
      href: `/trips/${tripId}`,
      anchor: null,
    });
    // Home is drawn from the first privacy-safe fix at home, never from the stored place.
    expect(context.find((c) => c.kind === "home")).toMatchObject({
      href: null,
      anchor: { lat: 37.5501, lon: 126.99 },
    });
    const moving = context.filter((c) => c.unlabelled === true);
    expect(moving).toEqual([
      expect.objectContaining({
        kind: "movement",
        label: "",
        fromMs: DAY_START + 10 * MIN,
        untilMs: DAY_START + 20 * MIN,
        anchor: { lat: 37.5501, lon: 126.99 },
      }),
    ]);
  });

  it("a reported gap is phonePaused, a deleted range is deleted, nothing marks a zone", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Büro", lat: 37.6, lon: 127.1, radiusM: 300 },
    });
    await storePoint(userId, { t: DAY_START + 60 * MIN, lat: 37.5, lon: 127 });
    await storePoint(userId, { t: DAY_START + 65 * MIN, lat: 37.501, lon: 127 });
    // Two hours inside the zone (stored before it existed, say): they never show.
    await storePoint(userId, { t: DAY_START + 120 * MIN, lat: 37.6, lon: 127.1 });
    await storePoint(userId, { t: DAY_START + 180 * MIN, lat: 37.6001, lon: 127.1 });
    await storePoint(userId, { t: DAY_START + 240 * MIN, lat: 37.502, lon: 127 });
    await storePoint(userId, { t: DAY_START + 245 * MIN, lat: 37.503, lon: 127 });
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-1",
        fromAt: new Date(DAY_START + 300 * MIN),
        toAt: new Date(DAY_START + 360 * MIN),
        reason: "recorderSilent",
      },
    });
    await prisma.travTrackDeletedRange.create({
      data: {
        userId,
        fromAt: new Date(DAY_START + 400 * MIN),
        toAt: new Date(DAY_START + 460 * MIN),
      },
    });

    const res = await day();
    expect(res.body.pointCount).toBe(4);
    expect(res.body.segments).toHaveLength(2);
    const coverage = res.body.coverage as Array<{ fromMs: number; untilMs: number; state: string }>;
    expect(new Set(coverage.map((c) => c.state))).toEqual(
      new Set(["noData", "recorded", "phonePaused", "deleted"])
    );
    expect(coverage).toContainEqual({
      fromMs: DAY_START + 300 * MIN,
      untilMs: DAY_START + 360 * MIN,
      state: "phonePaused",
    });
    expect(coverage).toContainEqual({
      fromMs: DAY_START + 400 * MIN,
      untilMs: DAY_START + 460 * MIN,
      state: "deleted",
    });
    // The hours in the zone read like any hour without a fix.
    expect(coverage).toContainEqual({
      fromMs: DAY_START + 65 * MIN,
      untilMs: DAY_START + 240 * MIN,
      state: "noData",
    });
  });

  it("answers 403 TRAVTRACK_DISABLED while TravTrack is off, and 400 for a bad date", async () => {
    expect((await day("12.10.2026")).status).toBe(400);
    await switches.set({ beta: true, config: false });
    await storePoint(userId, { t: DAY_START, lat: 37.5, lon: 127 });
    const res = await day();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });
});

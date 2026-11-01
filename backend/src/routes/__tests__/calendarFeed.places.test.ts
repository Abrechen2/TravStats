import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#405 item 16: the feed said a place visit "is a record, nothing in it
 * is scheduled" — contradicted by the counting rule, where a visit dated in the
 * future is a plan. Planned visits are in the feed; visits that happened, and
 * undated ones, are not.
 *
 * The clock is pinned to 2030-05-20 10:00 UTC.
 */
const PREFIX = "calfeed-places-";

describe("calendar feed — planned place visits", () => {
  let betaBefore: boolean;
  let cookie: string;
  let offCookie: string;
  let userId: string;

  const visit = (id: string, placeId: string, over: Record<string, unknown>) =>
    prisma.placeVisit.create({ data: { id, userId, placeId, ...over } });

  const feedText = async (c: string): Promise<string> => {
    const issued = await request(app).post("/api/v1/calendar-feed").set("Cookie", c);
    expect(issued.status).toBe(201);
    const res = await request(app).get(new URL(issued.body.data.url).pathname);
    expect(res.status).toBe(200);
    return res.text.replace(/\r\n /g, "");
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    setClockForTests("2030-05-20T10:00:00Z");

    const user = await prisma.user.create({
      data: { username: `${PREFIX}owner`, passwordHash: "x" },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["flight", "poi"] },
    });
    cookie = `auth_token=${generateToken(userId)}`;

    const off = await prisma.user.create({ data: { username: `${PREFIX}off`, passwordHash: "x" } });
    await prisma.userSettings.create({
      data: { userId: off.id, data: {}, enabledDomains: ["flight"] },
    });
    offCookie = `auth_token=${generateToken(off.id)}`;
    const offPlace = await prisma.place.create({
      data: { userId: off.id, name: "Hidden Domain Place", lat: 1, lon: 1 },
    });
    await prisma.placeVisit.create({
      data: {
        userId: off.id,
        placeId: offPlace.id,
        visitedAt: new Date("2030-07-01T10:00:00Z"),
        visitedAtUtc: new Date("2030-07-01T08:00:00Z"),
        visitedZone: "Europe/Rome",
        visitedPrecision: "minute",
      },
    });

    const place = await prisma.place.create({
      data: { userId, name: "Kolosseum", city: "Rom", country: "Italien", lat: 41.89, lon: 12.49 },
    });
    // Planned, to the minute: 10:00 in Rome (08:00 UTC, CEST).
    await visit("00000000-0000-4000-8000-00000000a001", place.id, {
      visitedAt: new Date("2030-07-01T10:00:00Z"),
      visitedAtUtc: new Date("2030-07-01T08:00:00Z"),
      visitedZone: "Europe/Rome",
      visitedPrecision: "minute",
    });
    // Planned, known to the day only.
    await visit("00000000-0000-4000-8000-00000000a002", place.id, {
      visitedAt: new Date("2030-07-02T00:00:00Z"),
      visitedAtUtc: new Date("2030-07-01T22:00:00Z"),
      visitedZone: "Europe/Rome",
      visitedPrecision: "day",
    });
    // Happened: history, not an appointment.
    await visit("00000000-0000-4000-8000-00000000a003", place.id, {
      visitedAt: new Date("2030-05-10T10:00:00Z"),
      visitedAtUtc: new Date("2030-05-10T08:00:00Z"),
      visitedZone: "Europe/Rome",
      visitedPrecision: "minute",
    });
    // Undated: no day a calendar could put it on.
    await visit("00000000-0000-4000-8000-00000000a004", place.id, { visitedAt: null });
  });

  afterAll(async () => {
    setClockForTests(null);
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("draws a planned visit on the place's clock and a day-only one as an all-day event", async () => {
    const text = await feedText(cookie);
    expect(text).toContain(
      "UID:place-visit-00000000-0000-4000-8000-00000000a001@travstats\r\nDTSTAMP:20300520T100000Z\r\n" +
        "DTSTART;TZID=Europe/Rome:20300701T100000"
    );
    expect(text).toContain("SUMMARY:📍 Kolosseum");
    expect(text).toContain(
      "UID:place-visit-00000000-0000-4000-8000-00000000a002@travstats\r\nDTSTAMP:20300520T100000Z\r\n" +
        "DTSTART;VALUE=DATE:20300702\r\nDTEND;VALUE=DATE:20300703"
    );
  });

  it("leaves out a visit that has happened and an undated one", async () => {
    const text = await feedText(cookie);
    expect(text).not.toContain("00000000a003");
    expect(text).not.toContain("00000000a004");
  });

  it("draws nothing for a user with the places domain switched off", async () => {
    const text = await feedText(offCookie);
    expect(text).not.toContain("UID:place-visit-");
    expect(text).not.toContain("Hidden Domain Place");
  });
});

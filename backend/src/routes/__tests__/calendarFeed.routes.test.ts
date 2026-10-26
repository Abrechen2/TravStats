import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import { toDbDate } from "../../shared/time/localDate";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { generateApiToken } from "../../utils/apiTokens";
import { generateToken } from "../../utils/jwt";
import { requestPathForLog } from "../../utils/logging/requestPath";

/**
 * The calendar subscription end to end (forgejo#310), through the real app so
 * the mount order, the `/api` no-store default and the error handler are the
 * ones a calendar app meets.
 *
 * The clock is pinned to 2030-05-20 10:00 UTC; the look-back is 30 days, so
 * an entry that ended on 2030-04-25 is in and one from March is out.
 */

const PREFIX = "calfeed-test-";
const NOW = "2030-05-20T10:00:00Z";

interface Account {
  id: string;
  cookie: string;
}

async function account(name: string, enabledDomains: string[]): Promise<Account> {
  const user = await prisma.user.create({
    data: { username: `${PREFIX}${name}`, passwordHash: "x" },
  });
  await prisma.userSettings.create({ data: { userId: user.id, data: {}, enabledDomains } });
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` };
}

const flight = (userId: string, id: string, departure: string, extra: object = {}) =>
  prisma.flight.create({
    data: {
      id,
      userId,
      flightNumber: "LH2280",
      airlineIata: "LH",
      depIata: "MUC",
      depLat: 48.35,
      depLon: 11.79,
      depTimezone: "Europe/Berlin",
      arrIata: "VIE",
      arrLat: 48.11,
      arrLon: 16.57,
      arrTimezone: "Europe/Vienna",
      departureTime: new Date(departure),
      arrivalTime: new Date(new Date(departure).getTime() + 75 * 60_000),
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      status: "scheduled",
      ...extra,
    },
  });

const ride = {
  depStationName: "München Hbf",
  depLat: 48.14,
  depLon: 11.56,
  depTimezone: "Europe/Berlin",
  arrStationName: "Zürich HB",
  arrLat: 47.38,
  arrLon: 8.54,
  arrTimezone: "Europe/Zurich",
};

const feedPath = (url: string): string => new URL(url).pathname;

async function issue(owner: Account): Promise<{ url: string; webcalUrl: string }> {
  const res = await request(app).post("/api/v1/calendar-feed").set("Cookie", owner.cookie);
  expect(res.status).toBe(201);
  return res.body.data;
}

/** A calendar with its folded lines joined back (RFC 5545 §3.1). */
const unfolded = (text: string): string => text.replace(/\r\n /g, "");

describe("calendar feed", () => {
  let betaBefore: boolean;
  let owner: Account;
  let stranger: Account;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    setClockForTests(NOW);

    // Rail and the roadtrip domain are on; bus is NOT, though a ride exists.
    owner = await account("owner", ["flight", "lodging", "cruise", "rail", "roadtrip"]);
    stranger = await account("stranger", ["flight"]);

    await flight(owner.id, "00000000-0000-4000-8000-0000000000a1", "2030-06-01T12:00:00Z");
    await flight(owner.id, "00000000-0000-4000-8000-0000000000a2", "2030-04-25T08:00:00Z");
    await flight(owner.id, "00000000-0000-4000-8000-0000000000a3", "2030-03-01T08:00:00Z");
    await flight(owner.id, "00000000-0000-4000-8000-0000000000a4", "2030-06-02T12:00:00Z", {
      status: "cancelled",
    });
    await flight(stranger.id, "00000000-0000-4000-8000-0000000000b1", "2030-06-03T12:00:00Z");

    const lodging = await prisma.lodging.create({
      data: { userId: owner.id, name: "Hotel Sacher, Wien", city: "Wien" },
    });
    await prisma.lodgingStay.create({
      data: {
        id: "00000000-0000-4000-8000-0000000000c1",
        userId: owner.id,
        lodgingId: lodging.id,
        checkIn: toDbDate("2030-06-01"),
        checkOut: toDbDate("2030-06-04"),
        checkInDate: toDbDate("2030-06-01"),
        checkOutDate: toDbDate("2030-06-04"),
        stayZone: "Europe/Vienna",
        datePrecision: "DAY",
        status: "scheduled",
      },
    });
    await prisma.cruise.create({
      data: {
        id: "00000000-0000-4000-8000-0000000000d1",
        userId: owner.id,
        shipNameOverride: "AIDAprima",
        startDate: toDbDate("2030-07-01"),
        endDate: toDbDate("2030-07-08"),
        startDay: toDbDate("2030-07-01"),
        endDay: toDbDate("2030-07-08"),
      },
    });
    await prisma.trip.create({
      data: {
        id: "00000000-0000-4000-8000-0000000000e1",
        userId: owner.id,
        name: "Wien; Sommer",
        startDay: toDbDate("2030-06-01"),
        endDay: toDbDate("2030-06-04"),
      },
    });
    await prisma.railJourney.create({
      data: {
        id: "00000000-0000-4000-8000-0000000000f1",
        userId: owner.id,
        ...ride,
        departureTime: new Date("2030-06-05T07:00:00Z"),
        arrivalTime: new Date("2030-06-05T10:30:00Z"),
        depPrecision: "minute",
        arrPrecision: "minute",
      },
    });
    await prisma.busJourney.create({
      data: {
        id: "00000000-0000-4000-8000-000000000101",
        userId: owner.id,
        ...ride,
        departureTime: new Date("2030-06-06T07:00:00Z"),
      },
    });
    const roadtrip = await prisma.tripRoute.create({
      data: { userId: owner.id, name: "Alpen", mode: "car", kind: "roadtrip" },
    });
    await prisma.tripStop.create({
      data: {
        id: "00000000-0000-4000-8000-000000000111",
        routeId: roadtrip.id,
        routeOrderIdx: 0,
        title: "Innsbruck",
        startUtc: new Date("2030-06-09T22:00:00Z"), // 10 June, start of day in Innsbruck
        endUtc: new Date("2030-06-11T22:00:00Z"),
        stopZone: "Europe/Vienna",
      },
    });
    await prisma.tripRoute.create({
      data: {
        id: "00000000-0000-4000-8000-000000000121",
        userId: owner.id,
        name: "Nordkette",
        mode: "foot",
        kind: "tour",
        tourDate: toDbDate("2030-06-12"),
      },
    });
  });

  afterAll(async () => {
    setClockForTests(null);
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("issues a URL once, as https and as webcal, and reports it as active", async () => {
    const before = await request(app).get("/api/v1/calendar-feed").set("Cookie", owner.cookie);
    expect(before.body.data).toMatchObject({ enabled: true, active: false });

    const { url, webcalUrl } = await issue(owner);
    expect(url).toMatch(/\/api\/v1\/calendar\/ts_cal_[A-Za-z0-9_-]{43}\.ics$/);
    expect(webcalUrl).toBe(url.replace(/^https?:\/\//, "webcal://"));

    const after = await request(app).get("/api/v1/calendar-feed").set("Cookie", owner.cookie);
    expect(after.body.data).toMatchObject({ enabled: true, active: true, lastUsedAt: null });
    // The token is shown once; the state never carries it.
    expect(JSON.stringify(after.body)).not.toContain("ts_cal_");
    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain(row.tokenHash);
  });

  it("answers the owner's calendar with no cookie, as private text/calendar", async () => {
    const { url } = await issue(owner);
    const res = await request(app).get(feedPath(url));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/calendar; charset=utf-8/);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(res.text.endsWith("END:VCALENDAR\r\n")).toBe(true);

    const text = unfolded(res.text);
    // Upcoming, and inside the 30-day look-back.
    expect(text).toContain("UID:flight-00000000-0000-4000-8000-0000000000a1@travstats");
    expect(text).toContain("UID:flight-00000000-0000-4000-8000-0000000000a2@travstats");
    // On each airport's clock: 14:00 in Munich, 15:15 in Vienna.
    expect(text).toContain(
      "DTSTART;TZID=Europe/Berlin:20300601T140000\r\nDTEND;TZID=Europe/Vienna:20300601T151500"
    );
    expect(text).toMatch(/SUMMARY:✈ [^\r]* 14:00 → [^\r]* 15:15 · LH2280\r\n/);
    // Stay: its nights, the check-out day excluded; its name escaped.
    expect(text).toContain(
      "UID:stay-00000000-0000-4000-8000-0000000000c1@travstats\r\nDTSTAMP:20300520T100000Z\r\n" +
        "DTSTART;VALUE=DATE:20300601\r\nDTEND;VALUE=DATE:20300604"
    );
    expect(text).toContain("SUMMARY:🏨 Hotel Sacher\\, Wien");
    // Cruise and trip: inclusive spans; the trip name escaped.
    expect(text).toContain("DTSTART;VALUE=DATE:20300701\r\nDTEND;VALUE=DATE:20300709");
    expect(text).toContain("SUMMARY:🧳 Wien\\; Sommer");
    expect(text).toContain("UID:rail-00000000-0000-4000-8000-0000000000f1@travstats");
    // A roadtrip station on Innsbruck's days, not the UTC dates (9th–11th).
    expect(text).toContain(
      "UID:roadtrip-station-00000000-0000-4000-8000-000000000111@travstats\r\n" +
        "DTSTAMP:20300520T100000Z\r\nDTSTART;VALUE=DATE:20300610\r\nDTEND;VALUE=DATE:20300613"
    );
    // A day tour on its day (tours ride on the roadtrip switch).
    expect(text).toContain(
      "UID:tour-00000000-0000-4000-8000-000000000121@travstats\r\n" +
        "DTSTAMP:20300520T100000Z\r\nDTSTART;VALUE=DATE:20300612\r\nDTEND;VALUE=DATE:20300613"
    );
  });

  it("writes a Korea flight on Seoul's clock, with its local times in the summary", async () => {
    // KE1206 as the owner saw it: 03:05 UTC is 12:05 in Seoul, not 05:05 in Germany.
    await flight(owner.id, "00000000-0000-4000-8000-0000000000a5", "2030-06-15T03:05:00Z", {
      flightNumber: "KE1206",
      airlineIata: "KE",
      depIata: "CJU",
      depLat: 33.51,
      depLon: 126.49,
      depTimezone: "Asia/Seoul",
      arrIata: "GMP",
      arrLat: 37.56,
      arrLon: 126.79,
      arrTimezone: "Asia/Seoul",
      arrivalTime: new Date("2030-06-15T04:10:00Z"),
    });
    const { url } = await issue(owner);
    const text = unfolded((await request(app).get(feedPath(url))).text);
    expect(text).toContain(
      "DTSTART;TZID=Asia/Seoul:20300615T120500\r\nDTEND;TZID=Asia/Seoul:20300615T131000"
    );
    expect(text).toContain("BEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\n");
    expect(text).toMatch(/SUMMARY:✈ [^\r]* 12:05 → [^\r]* 13:10 · KE1206\r\n/);
    // The rail ride the same way: 09:00 in Munich, 12:30 in Zurich.
    expect(text).toMatch(/SUMMARY:🚆 München Hbf 09:00 → Zürich HB 12:30\r\n/);
  });

  it("leaves out cancelled entries, entries older than the look-back, and switched-off domains", async () => {
    const { url } = await issue(owner);
    const text = unfolded((await request(app).get(feedPath(url))).text);
    expect(text).not.toContain("0000000000a3"); // March: before the window
    expect(text).not.toContain("0000000000a4"); // cancelled
    expect(text).not.toContain("UID:bus-"); // bus is not switched on
    expect(text).not.toContain("000000000101");
  });

  it("never shows another user's entries", async () => {
    const { url } = await issue(owner);
    const text = (await request(app).get(feedPath(url))).text;
    expect(text).not.toContain("0000000000b1");

    const theirs = await issue(stranger);
    const theirText = (await request(app).get(feedPath(theirs.url))).text;
    expect(theirText).toContain("0000000000b1");
    expect(theirText).not.toContain("0000000000a1");
    expect(theirText).not.toContain("Sacher");
  });

  it("records when a calendar app last read the feed", async () => {
    const { url } = await issue(owner);
    await request(app).get(feedPath(url));
    const state = await request(app).get("/api/v1/calendar-feed").set("Cookie", owner.cookie);
    expect(state.body.data.lastUsedAt).toBe(new Date(NOW).toISOString());
  });

  it("answers 404 once revoked, and a regenerated URL replaces the old one", async () => {
    const first = await issue(owner);
    const second = await issue(owner);
    expect(second.url).not.toBe(first.url);
    expect((await request(app).get(feedPath(first.url))).status).toBe(404);
    expect((await request(app).get(feedPath(second.url))).status).toBe(200);

    const revoked = await request(app).delete("/api/v1/calendar-feed").set("Cookie", owner.cookie);
    expect(revoked.body).toEqual({ success: true, data: { revoked: true } });
    const gone = await request(app).get(feedPath(second.url));
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe("CALENDAR_FEED_NOT_FOUND");
    // A failure is not cached anywhere either.
    expect(gone.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    ["an unknown token", `/api/v1/calendar/ts_cal_${"A".repeat(43)}.ics`],
    ["a malformed token", "/api/v1/calendar/ts_cal_short.ics"],
    ["no .ics suffix", `/api/v1/calendar/ts_cal_${"A".repeat(43)}`],
    ["something else entirely", "/api/v1/calendar/whatever.ics"],
  ])("answers the same 404 for %s", async (_label, path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CALENDAR_FEED_NOT_FOUND");
  });

  it("builds the link on a known name rather than an IP, and flags an address the internet cannot reach", async () => {
    // The stored row, not the ENV-merged view, so the restore writes back what was there.
    const before = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    try {
      await updateInstanceSettings({
        publicUrl: "http://192.168.178.120:3010",
        frontendUrl: "https://trav.example.org",
      });
      const named = await request(app).post("/api/v1/calendar-feed").set("Cookie", owner.cookie);
      expect(named.body.data.url).toMatch(/^https:\/\/trav\.example\.org\/api\/v1\/calendar\//);
      expect(named.body.data.reachableFromInternet).toBe(true);

      await updateInstanceSettings({ publicUrl: "http://192.168.178.120:3010", frontendUrl: null });
      const ip = await request(app)
        .post("/api/v1/calendar-feed")
        .set("Cookie", owner.cookie)
        .set("Host", "10.0.0.7:8000");
      expect(ip.body.data.url).toMatch(/^http:\/\/192\.168\.178\.120:3010\//);
      expect(ip.body.data.reachableFromInternet).toBe(false);
    } finally {
      await updateInstanceSettings({ publicUrl: before.publicUrl, frontendUrl: before.frontendUrl });
    }
  });

  it("is off with the instance's beta switch: no URL issued, none answered", async () => {
    const { url } = await issue(owner);
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    try {
      expect((await request(app).get(feedPath(url))).status).toBe(404);
      const refused = await request(app).post("/api/v1/calendar-feed").set("Cookie", owner.cookie);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("CALENDAR_FEED_DISABLED");
      const state = await request(app).get("/api/v1/calendar-feed").set("Cookie", owner.cookie);
      expect(state.body.data.enabled).toBe(false);
    } finally {
      await updateInstanceSettings({ betaFeaturesEnabled: true });
    }
    expect((await request(app).get(feedPath(url))).status).toBe(200);
  });

  it("is managed from a browser session only — an API token cannot mint one", async () => {
    const tok = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: owner.id,
        label: `${PREFIX}pat`,
        lookupHash: tok.lookupHash,
        hash: tok.hash,
        scope: "admin",
      },
    });
    const res = await request(app)
      .post("/api/v1/calendar-feed")
      .set("Authorization", `Bearer ${tok.plaintext}`);
    expect(res.status).toBe(403);
  });

  it("requires a session to manage the URL", async () => {
    expect((await request(app).get("/api/v1/calendar-feed")).status).toBe(401);
  });

  it("keeps the token out of every logged request path", () => {
    const token = `ts_cal_${"Q".repeat(43)}`;
    const logged = requestPathForLog({ originalUrl: `/api/v1/calendar/${token}.ics`, url: "" });
    expect(logged).toBe("/api/v1/calendar/ts_cal_[redacted].ics");
  });
});

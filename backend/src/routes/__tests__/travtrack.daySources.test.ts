import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * The best-source routes: the day's sources in the day view, the list of
 * questionable days, a source choice and its failure paths, and the preview of
 * a range delete.
 */

const PREFIX = "travtrack-daysources-";
const H = 3_600_000;
const MIN = 60_000;
const D10 = Date.parse("2026-08-10T00:00:00Z");

describe("TravTrack — best source per day (routes)", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  async function walk(origin: string, fromMs: number, untilMs: number, stepMin: number, dLat = 0) {
    const rows = [];
    for (let t = fromMs; t < untilMs; t += stepMin * MIN) {
      rows.push({
        userId,
        t: new Date(t),
        tS: Math.floor(t / 1000),
        lat: 48.137 + dLat,
        lon: 11.575 + ((t - fromMs) / H) * 0.01,
        accuracyM: origin.startsWith("gpx:") ? null : 8,
        origin,
        originRef: `${origin}-${t}`,
        deviceId: origin.startsWith("companion:") ? "phone-1" : null,
      });
    }
    await prisma.travTrackPoint.createMany({ data: rows });
  }

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });
  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({ data: { userId, data: { display: { timezone: "UTC" } } } });
  });
  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("names a phone source by its paired device, not by its device id", async () => {
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.apiToken.create({
      data: {
        userId,
        label: "iPhone 15",
        lookupHash: `lookup-${PREFIX}${Date.now()}`,
        hash: "x",
        scope: "write",
        deviceId: "phone-1",
      },
    });
    await walk("companion:phone-1", D10 + 8 * H, D10 + 12 * H, 1);
    await walk("gpx:takeout", D10 + 8 * H, D10 + 12 * H, 15, 0.01);
    const day = await request(app)
      .get("/api/v1/travtrack/day")
      .query({ date: "2026-08-10" })
      .set("Cookie", cookie);
    expect(day.status).toBe(200);
    expect(day.body.sources.sources).toEqual([
      expect.objectContaining({ source: "companion:phone-1", name: "iPhone 15" }),
      expect.objectContaining({ source: "gpx:takeout", name: null }),
    ]);
  });

  it("the day view names the source in use and lists a mixed day as questionable", async () => {
    await walk("companion:phone-1", D10 + 8 * H, D10 + 12 * H, 1);
    await walk("gpx:takeout", D10 + 8 * H, D10 + 12 * H, 15, 0.01);
    const day = await request(app)
      .get("/api/v1/travtrack/day")
      .query({ date: "2026-08-10" })
      .set("Cookie", cookie);
    expect(day.status).toBe(200);
    expect(day.body.sources).toMatchObject({
      scored: true,
      mixed: true,
      questionable: true,
      segments: [{ source: "companion:phone-1" }],
    });
    expect(day.body.sources.sources.map((s: { kind: string }) => s.kind)).toEqual([
      "phone",
      "import",
    ]);
    expect(day.body.omitted.sourceExcluded).toBe(16);

    const list = await request(app)
      .get("/api/v1/travtrack/day-sources/questionable")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      total: 1,
      days: [expect.objectContaining({ date: "2026-08-10", reasons: ["mixed"] })],
    });

    // Choosing a source settles the day.
    const put = await request(app)
      .put("/api/v1/travtrack/day-sources/2026-08-10")
      .set("Cookie", cookie)
      .send({ overrideSource: "companion:phone-1" });
    expect(put.status).toBe(200);
    expect(put.body.questionable).toBe(false);
    const after = await request(app)
      .get("/api/v1/travtrack/day-sources/questionable")
      .set("Cookie", cookie);
    expect(after.body.total).toBe(0);
  });

  it("answers a bad choice with a code the web can show", async () => {
    await walk("companion:phone-1", D10 + 8 * H, D10 + 9 * H, 5);
    const empty = await request(app)
      .put("/api/v1/travtrack/day-sources/2026-08-10")
      .set("Cookie", cookie)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("VALIDATION_FAILED");
    const notOnDay = await request(app)
      .put("/api/v1/travtrack/day-sources/2026-08-10")
      .set("Cookie", cookie)
      .send({ overrideSource: "gpx:nothing" });
    expect(notOnDay.status).toBe(400);
    expect(notOnDay.body.code).toBe("TRAVTRACK_SOURCE_NOT_ON_DAY");
    const noDay = await request(app)
      .put("/api/v1/travtrack/day-sources/2026-08-20")
      .set("Cookie", cookie)
      .send({ outlierDecision: "discard" });
    expect(noDay.status).toBe(404);
    expect(noDay.body.code).toBe("TRAVTRACK_DAY_NO_POINTS");
  });

  it("previews a range delete per day and source, and removes nothing", async () => {
    await walk("companion:phone-1", D10 + 8 * H, D10 + 9 * H, 10);
    await walk("gpx:takeout", D10 + 24 * H + 8 * H, D10 + 24 * H + 9 * H, 30);
    const res = await request(app)
      .get("/api/v1/travtrack/points/delete-preview")
      .query({ fromDay: "2026-08-10", toDay: "2026-08-11" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      points: 8,
      days: [
        { date: "2026-08-10", points: 6, sources: { "companion:phone-1": 6 } },
        { date: "2026-08-11", points: 2, sources: { "gpx:takeout": 2 } },
      ],
    });
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(8);
  });
});

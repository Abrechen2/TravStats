import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/export` (TravTrack plan T6): the account's TravTrack
 * history of a span as GPX or JSON, privacy-cut, saying where it came from and
 * whether it is whole. Reachable with TravTrack off while the account holds
 * data (review focus 14); at most 366 days per request.
 */

const PREFIX = "travtrack-export-";
const MIN = 60_000;
const T0 = Date.parse("2026-10-12T00:00:00Z");

describe("TravTrack — the export", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const exportOf = (query: object) =>
    request(app).get("/api/v1/travtrack/export").query(query).set("Cookie", cookie);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.userSettings.deleteMany({ where: { userId } });
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: T0 + i * MIN, lat: 37.5 + i * 0.001, lon: 127 });
    }
    // Five hours later, far away: a second stretch.
    for (let i = 0; i < 2; i++) {
      await storePoint(userId, { t: T0 + (300 + i) * MIN, lat: 35.1 + i * 0.001, lon: 129 });
    }
    await storePoint(otherId, { t: T0 + MIN, lat: 1, lon: 1 });
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-1",
        fromAt: new Date(T0 + 10 * MIN),
        toAt: new Date(T0 + 20 * MIN),
        reason: "permission",
      },
    });
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date(T0 + 30 * MIN), toAt: new Date(T0 + 40 * MIN) },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const span = {
    from: new Date(T0 - 60 * MIN).toISOString(),
    to: new Date(T0 + 24 * 60 * MIN).toISOString(),
  };

  it("export JSON carries origin and coverage, only the owner's points, gaps and deleted spans", async () => {
    const res = await exportOf({ ...span, format: "json" });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".+\.json"/);
    const body = JSON.parse(res.text);
    expect(body).toMatchObject({
      version: 1,
      origin: "travtrack",
      coverage: "complete",
      next: null,
    });
    expect(body.points).toHaveLength(5);
    expect(body.points.map((p: { segment: number }) => p.segment)).toEqual([0, 0, 0, 1, 1]);
    expect(body.points[0]).toMatchObject({ t: new Date(T0).toISOString(), lat: 37.5, lon: 127 });
    expect(body.gaps).toEqual([
      {
        from: new Date(T0 + 10 * MIN).toISOString(),
        to: new Date(T0 + 20 * MIN).toISOString(),
        reason: "permission",
        deviceId: "phone-1",
      },
    ]);
    expect(body.deletedRanges).toEqual([
      { from: new Date(T0 + 30 * MIN).toISOString(), to: new Date(T0 + 40 * MIN).toISOString() },
    ]);
  });

  it("export GPX carries origin and coverage, one track segment per stretch", async () => {
    const res = await exportOf({ ...span, format: "gpx" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/gpx\+xml/);
    expect(res.headers["x-travtrack-origin"]).toBe("travtrack");
    expect(res.headers["x-travtrack-coverage"]).toBe("complete");
    expect(res.text.match(/<trkseg>/g)).toHaveLength(2);
    expect(res.text.match(/<trkpt /g)).toHaveLength(5);
    expect(res.text).toContain("<desc>origin=travtrack; coverage=complete</desc>");
  });

  it("leaves out what a privacy zone covers", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 35.1, lon: 129, radiusM: 500 },
    });
    const body = JSON.parse((await exportOf({ ...span, format: "json" })).text);
    expect(body.points).toHaveLength(3);
  });

  it("refuses a span over 366 days", async () => {
    const res = await exportOf({ fromDay: "2025-01-01", toDay: "2026-01-02", format: "json" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAVTRACK_EXPORT_TOO_LONG");
    const year = await exportOf({ fromDay: "2025-01-01", toDay: "2026-01-01", format: "json" });
    expect(year.status).toBe(200);
  });

  it("answers with TravTrack off for an account holding data, and refuses one holding none", async () => {
    await switches.set({ beta: true, config: false });
    expect((await exportOf({ ...span, format: "json" })).status).toBe(200);
    await wipeTravTrack([userId]);
    const res = await exportOf({ ...span, format: "json" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });
});

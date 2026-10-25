import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/flights/:id/panel` (TravTrack plan T5.3): the altitude and
 * speed of the points linked to a flight, from the privacy-safe read —
 * nothing inside a zone, nothing unlinked, never joined across a cut — and a
 * summary that abstains (null, never 0) where a figure cannot be derived.
 */

const PREFIX = "travtrack-flight-panel-";
const T = Date.parse("2026-10-12T00:30:00Z");
const MIN = 60_000;

describe("TravTrack — flight panel", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let flightId: string;

  const panel = (id = flightId) =>
    request(app).get(`/api/v1/travtrack/flights/${id}/panel`).set("Cookie", cookie);

  /** A linked fix with altitude and speed, along a line heading south. */
  async function fix(
    minute: number,
    altitudeM: number | null,
    speedMps: number | null,
    link = true
  ) {
    const id = await storePoint(userId, {
      t: T + minute * MIN,
      lat: 37.4 - minute * 0.02,
      lon: 126.45,
      links: link ? [{ kind: "flight", id: flightId }] : [],
    });
    await prisma.travTrackPoint.update({ where: { id }, data: { altitudeM, speedMps } });
    return id;
  }

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    flightId = await makeFlight(userId);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("answers the series and derives the climb from a near-ground start", async () => {
    await fix(0, 100, 70);
    await fix(5, 5000, 180);
    await fix(10, 10000, 230);
    await fix(15, 10500, 240);
    await fix(20, 10400, 235);

    const res = await panel();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      flightId,
      series: [
        [
          [T, 100, 70],
          [T + 5 * MIN, 5000, 180],
          [T + 10 * MIN, 10000, 230],
          [T + 15 * MIN, 10500, 240],
          [T + 20 * MIN, 10400, 235],
        ],
      ],
      pointCount: 5,
      truncated: false,
      summary: { maxAltitudeM: 10500, maxSpeedMps: 240, climbToCruiseMinutes: 10 },
    });
  });

  it("abstains: a series starting in the air has no climb, no altitude means no maximum", async () => {
    await fix(0, 9000, null);
    await fix(5, 10000, null);
    let res = await panel();
    expect(res.body.summary).toEqual({
      maxAltitudeM: 10000,
      maxSpeedMps: null,
      climbToCruiseMinutes: null,
    });

    await wipeTravTrack([userId]);
    await fix(0, null, null);
    await fix(5, null, null);
    res = await panel();
    expect(res.body.summary).toEqual({
      maxAltitudeM: null,
      maxSpeedMps: null,
      climbToCruiseMinutes: null,
    });
  });

  it("an unlinked fix between two linked ones breaks the series instead of joining it", async () => {
    await fix(0, 100, 70);
    await fix(5, 5000, 180, false);
    await fix(10, 10000, 230);

    const res = await panel();

    expect(res.body.series).toEqual([[[T, 100, 70]], [[T + 10 * MIN, 10000, 230]]]);
    // The climb would cross the break: not derivable.
    expect(res.body.summary.climbToCruiseMinutes).toBeNull();
  });

  it("a linked point inside a privacy zone is not in the series", async () => {
    await fix(0, 100, 70);
    await fix(5, 5000, 180);
    await fix(10, 10000, 230);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zone", lat: 37.4 - 10 * 0.02, lon: 126.45, radiusM: 500 },
    });

    const res = await panel();

    const times = (res.body.series as number[][][]).flat().map((s) => s[0]);
    expect(times).not.toContain(T + 10 * MIN);
    expect(res.body.summary.maxAltitudeM).toBe(5000);
  });

  it("a flight without linked points answers an empty series, not zeros", async () => {
    const res = await panel();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      series: [],
      pointCount: 0,
      summary: { maxAltitudeM: null, maxSpeedMps: null, climbToCruiseMinutes: null },
    });
  });

  it("another account's flight, or no flight at all, is 404", async () => {
    const theirs = await makeFlight(otherId);
    expect((await panel(theirs)).status).toBe(404);
    expect((await panel(theirs)).body.code).toBe("TRAVTRACK_FLIGHT_NOT_FOUND");
    expect((await panel("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await panel("nope")).status).toBe(404);
  });

  it("TravTrack off → 403", async () => {
    await fix(0, 100, 70);
    await switches.set({ beta: true, config: false });
    expect((await panel()).status).toBe(403);
  });
});

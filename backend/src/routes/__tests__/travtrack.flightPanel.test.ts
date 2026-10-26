import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackFlightPanel } from "../../services/travtrack/flightPanel";
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
    link = true,
    device?: string
  ) {
    const id = await storePoint(userId, {
      t: T + minute * MIN,
      lat: 37.4 - minute * 0.02,
      lon: 126.45,
      device,
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

  it("answers the series and counts the climb from the take-off", async () => {
    await fix(0, 100, 20);
    await fix(5, 5000, 180);
    await fix(10, 10000, 230);
    await fix(15, 10500, 240);
    await fix(20, 10400, 235);

    const res = await panel();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      flightId,
      label: "KE1201 ICN–CJU",
      departureZone: "Asia/Seoul",
      basis: "linked",
      takeoffMs: T + 5 * MIN,
      landingMs: null,
      series: [
        [
          [T, 100, 20],
          [T + 5 * MIN, 5000, 180],
          [T + 10 * MIN, 10000, 230],
          [T + 15 * MIN, 10500, 240],
          [T + 20 * MIN, 10400, 235],
        ],
      ],
      pointCount: 5,
      truncated: false,
      summary: { maxAltitudeM: 10500, maxSpeedMps: 240, climbToCruiseMinutes: 5 },
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

  it("nothing linked: the fixes inside the flight's recorder window make the series (an import)", async () => {
    // The fixture flight departs at T and lands at T + 60 min; the window adds 30 min each side.
    await fix(-35, 10, 0, false); // before departure − 30 min: not this flight's
    await fix(-25, 50, 5, false);
    await fix(-20, 900, 90, false);
    await fix(-15, 9000, 220, false);

    const res = await panel();

    expect(res.status).toBe(200);
    expect(res.body.basis).toBe("window");
    expect(res.body.series).toEqual([
      [
        [T - 25 * MIN, 50, 5],
        [T - 20 * MIN, 900, 90],
        [T - 15 * MIN, 9000, 220],
      ],
    ]);
    expect(res.body.summary.maxAltitudeM).toBe(9000);
  });

  it("the window takes one source: another device's fixes in the same hours are left out, never zigzagged in", async () => {
    await fix(0, 100, 70, false, "phone-1");
    await fix(5, 5000, 180, false, "tablet");
    await fix(10, 10000, 230, false, "phone-1");
    await fix(15, 10500, 240, false, "phone-1");

    const res = await panel();

    expect(res.body.basis).toBe("window");
    expect(res.body.series).toEqual([
      [
        [T, 100, 70],
        [T + 10 * MIN, 10000, 230],
        [T + 15 * MIN, 10500, 240],
      ],
    ]);
  });

  it("the window's main source is counted over the whole window, not over a capped read", async () => {
    // phone-1 leads the first fixes, the tablet holds most of the window.
    await fix(0, 100, 70, false, "phone-1");
    await fix(1, 200, 80, false, "phone-1");
    for (let m = 2; m < 7; m++) await fix(m, 1000 * m, 200, false, "tablet");

    const res = await travTrackFlightPanel(userId, flightId, 3);

    expect(res.basis).toBe("window");
    expect(res.truncated).toBe(true);
    expect(res.series.flat().length).toBeGreaterThan(0);
    expect(res.series.flat().every(([, altitude]) => (altitude ?? 0) >= 1000)).toBe(true);
  });

  it("linked points win: the window's other fixes are not added", async () => {
    await fix(0, 100, 70);
    await fix(10, 10000, 230);
    await fix(20, 9999, 999, false);

    const res = await panel();

    expect(res.body.basis).toBe("linked");
    expect((res.body.series as number[][][]).flat().map((s) => s[0])).toEqual([T, T + 10 * MIN]);
  });

  it("the window keeps the privacy cut: a fix inside a zone is not in the series", async () => {
    await fix(0, 100, 70, false);
    await fix(5, 5000, 180, false);
    await fix(10, 10000, 230, false);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zone", lat: 37.4 - 10 * 0.02, lon: 126.45, radiusM: 500 },
    });

    const res = await panel();

    const times = (res.body.series as number[][][]).flat().map((s) => s[0]);
    expect(times).not.toContain(T + 10 * MIN);
    expect(res.body.summary.maxAltitudeM).toBe(5000);
  });

  it("a date-only flight arms no window: unlinked fixes on that day stay out", async () => {
    await prisma.flight.update({
      where: { id: flightId },
      data: { depPrecision: "day", arrPrecision: "day" },
    });
    await fix(0, 100, 70, false);
    await fix(10, 10000, 230, false);

    const res = await panel();

    expect(res.body).toMatchObject({ basis: null, series: [], pointCount: 0 });
  });

  it("a flight without linked points answers an empty series, not zeros", async () => {
    const res = await panel();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      basis: null,
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

  it("bounds the read: more linked points than the cap never loads every link", async () => {
    for (let m = 0; m < 6; m++) await fix(m, 1000 + m * 100, 200);
    const returned: number[] = [];
    const original = prisma.travTrackPointLink.findMany.bind(prisma.travTrackPointLink);
    const spy = jest.spyOn(prisma.travTrackPointLink, "findMany").mockImplementation(((
      args: Parameters<typeof original>[0]
    ) =>
      original(args).then((rows) => {
        returned.push(rows.length);
        return rows;
      })) as unknown as typeof prisma.travTrackPointLink.findMany);
    try {
      const res = await travTrackFlightPanel(userId, flightId, 3);
      expect(res.truncated).toBe(true);
      expect(res.pointCount).toBeLessThanOrEqual(3);
      expect(Math.max(0, ...returned)).toBeLessThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("reads past one page: the apex of a recording longer than a page survives", async () => {
    // Page of 2, total cap 10: the apex sits in the third page.
    for (let m = 0; m < 6; m++) await fix(m, m === 4 ? 12562 : 1000 + m * 100, 200);
    const res = await travTrackFlightPanel(userId, flightId, { total: 10, page: 2 });
    expect(res.truncated).toBe(false);
    expect(res.pointCount).toBe(6);
    expect(res.summary.maxAltitudeM).toBe(12562);
  });

  it("the total cap is the bound: past it the answer says truncated", async () => {
    for (let m = 0; m < 6; m++) await fix(m, 1000 + m * 100, 200);
    const res = await travTrackFlightPanel(userId, flightId, { total: 4, page: 2 });
    expect(res.truncated).toBe(true);
    expect(res.pointCount).toBeLessThanOrEqual(4);
  });

  it("TravTrack off → 403", async () => {
    await fix(0, 100, 70);
    await switches.set({ beta: true, config: false });
    expect((await panel()).status).toBe(403);
  });
});

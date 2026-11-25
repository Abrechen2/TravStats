jest.mock("../../services/egress/boundedFetch", () => ({
  ...jest.requireActual("../../services/egress/boundedFetch"),
  boundedFetch: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { boundedFetch } from "../../services/egress/boundedFetch";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { generateToken } from "../../utils/jwt";
import { deleteTravTrackRange } from "../../services/travtrack/deleteRange";
import { createZone } from "../../services/travtrack/zones";

/**
 * The optional cleanup of a TravTrack day (rc46 extras C): smoothing as a
 * drawing choice, road matching through the admin's own router — off by
 * default, privacy zones cut out before the request, nothing sent before
 * the account confirms the router, labelled and undoable, raw points
 * untouched throughout.
 */

const PREFIX = "travtrack-cleanup-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T22:00:00Z"); // 12 Oct 00:00 in Berlin
const T0 = DAY_START + 9 * 60 * MIN;
const fetchMock = jest.mocked(boundedFetch);
const ROUTER = "http://192.168.1.5:8002";
/** Google's encoded polyline, precision 6. */
function encode(points: [number, number][]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const one = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e6);
    const lo = Math.round(lon * 1e6);
    one(la - pLat);
    one(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}
/** The road along the drive and a little on, 48.00 → 48.14 at 7.8. */
const ROAD = encode(Array.from({ length: 15 }, (_, i): [number, number] => [7.8, 48 + i * 0.01]));
const ok = (confidence = 0.9) => ({
  status: 200,
  headers: new Headers(),
  body: Buffer.from(JSON.stringify({ shape: ROAD, confidence_score: confidence })),
});

describe("TravTrack — cleanup", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;
  let adminId: number;

  const match = (body: object = {}) =>
    request(app)
      .post("/api/v1/travtrack/cleanup/match")
      .set("Cookie", cookie)
      .send({ fromMs: T0, untilMs: T0 + 30 * MIN, ...body });
  const getDay = () =>
    request(app).get("/api/v1/travtrack/day").query({ date: "2026-10-12" }).set("Cookie", cookie);
  const router = (on: boolean, url: string | null = ROUTER) =>
    prisma.adminSettings.update({
      where: { id: adminId },
      data: {
        mapMatchingEnabled: on,
        mapMatchingUrl: url,
        mapMatchingEngine: "valhalla",
        internetEnabled: true,
      },
    });
  const confirm = { mode: "once", target: "valhalla@192.168.1.5:8002" };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
    adminId = await ensureAdminSettingsRow();
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackCleanup.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Europe/Berlin" } } },
    });
    await router(true);
    // A drive north, a fix a minute.
    for (let m = 0; m <= 30; m++) {
      await storePoint(userId, { t: T0 + m * MIN, lat: 48 + m * 0.004, lon: 7.8, accuracyM: 30 });
    }
  });

  afterAll(async () => {
    await router(false, null);
    await switches.restore();
    await wipeTravTrack([userId]);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is off by default, and says so instead of matching nothing", async () => {
    await router(false);
    const res = await match({ confirmation: confirm });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "MAP_MATCH_FAILED", reason: "serviceOff" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no router preconfigured", async () => {
    await router(true, null);
    const res = await match({ confirmation: confirm });
    expect(res.body).toMatchObject({ reason: "notConfigured" });
  });

  it("sends nothing before the confirmation, naming the router and the point count", async () => {
    const res = await match();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFIRMATION_REQUIRED");
    expect(res.body.disclosure).toEqual({
      serviceId: "mapMatching",
      host: "192.168.1.5:8002",
      provider: "valhalla",
      location: "lan",
      fields: ["points", "costing"],
      pointCount: 30,
      privacyZonesApplied: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuts privacy zones out before the request", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: 48.04, lon: 7.8, radiusM: 500 },
    });
    const res = await match({ confirmation: confirm });
    expect(res.status).toBe(201);
    const sent = fetchMock.mock.calls.flatMap(
      ([, init]) => JSON.parse(String(init.body)).shape as Array<{ lat: number }>
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((q) => Math.abs(q.lat - 48.04) < 0.0045)).toBe(false);
  });

  it("stores a labelled match, leaves the raw points alone, and undoes it", async () => {
    const before = await prisma.travTrackPoint.findMany({
      where: { userId },
      orderBy: { t: "asc" },
      select: { id: true, lat: true, lon: true, t: true },
    });
    const res = await match({ confirmation: confirm });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ provider: "192.168.1.5:8002", confidence: 0.9 });

    const day = await getDay();
    expect(day.body.cleanup.matched).toEqual([
      expect.objectContaining({ id: res.body.id, provider: "192.168.1.5:8002" }),
    ]);
    const after = await prisma.travTrackPoint.findMany({
      where: { userId },
      orderBy: { t: "asc" },
      select: { id: true, lat: true, lon: true, t: true },
    });
    expect(after).toEqual(before);

    await request(app)
      .delete(`/api/v1/travtrack/cleanup/match/${res.body.id}`)
      .set("Cookie", cookie)
      .expect(204);
    expect((await getDay()).body.cleanup.matched).toEqual([]);
  });

  describe("a match goes with the points it was matched from (security review)", () => {
    const matchRows = () => prisma.travTrackCleanup.count({ where: { userId, kind: "mapMatch" } });

    it("a range delete over the stretch removes the matched geometry", async () => {
      expect((await match({ confirmation: confirm })).status).toBe(201);
      await deleteTravTrackRange(userId, new Date(T0 + 5 * MIN), new Date(T0 + 10 * MIN));
      expect(await matchRows()).toBe(0);
      expect((await getDay()).body.cleanup.matched).toEqual([]);
    });

    it("a range delete elsewhere leaves it", async () => {
      await match({ confirmation: confirm });
      await deleteTravTrackRange(userId, new Date(T0 + 120 * MIN), new Date(T0 + 130 * MIN));
      expect(await matchRows()).toBe(1);
    });

    it("a new privacy zone the road line enters removes it", async () => {
      await match({ confirmation: confirm });
      // Past the last recorded fix, on the matched road line: no stored point is removed.
      await createZone(userId, { name: "New", lat: 48.135, lon: 7.8, radiusM: 300 }, false);
      expect(await matchRows()).toBe(0);
      expect((await getDay()).body.cleanup.matched).toEqual([]);
    });

    it("the stored line is privacy-cut before it is stored", async () => {
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Far", lat: 48.135, lon: 7.8, radiusM: 200 },
      });
      const res = await match({ confirmation: confirm });
      const row = await prisma.travTrackCleanup.findUniqueOrThrow({ where: { id: res.body.id } });
      const lats = (row.geometry as [number, number][][]).flat().map((c) => c[1]);
      expect(lats.some((lat) => Math.abs(lat - 48.135) < 0.0018)).toBe(false);
    });

    it("account deletion leaves no row", async () => {
      const other = await makeUser(`${PREFIX}gone`);
      await prisma.travTrackCleanup.create({
        data: { userId: other, kind: "mapMatch", fromMs: 0n, untilMs: 1n, geometry: [] },
      });
      await prisma.user.delete({ where: { id: other } });
      expect(await prisma.travTrackCleanup.count({ where: { userId: other } })).toBe(0);
    });
  });

  it("keeps a low-confidence match unmatched and says why", async () => {
    fetchMock.mockResolvedValue(ok(0.3));
    const res = await match({ confirmation: confirm });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "MAP_MATCH_FAILED", reason: "lowConfidence" });
    expect(await prisma.travTrackCleanup.count({ where: { userId } })).toBe(0);
  });

  it("a router that times out answers 504 as itself", async () => {
    const { BoundedFetchError } = jest.requireActual("../../services/egress/boundedFetch");
    fetchMock.mockRejectedValue(new BoundedFetchError("timeout"));
    const res = await match({ confirmation: confirm });
    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ reason: "timeout" });
  });

  it("uses the admin's LAN allowance and no other egress path", async () => {
    await match({ confirmation: confirm });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      policy: { allowPrivate: true },
      method: "POST",
    });
  });

  it("smoothing is off by default, per day and globally switchable, and never the raw read", async () => {
    let day = await getDay();
    expect(day.body.cleanup.smoothing).toMatchObject({ on: false, global: false, from: "global" });
    expect(day.body.cleanup.smoothed).toBeNull();
    await request(app)
      .put("/api/v1/travtrack/cleanup/smoothing")
      .set("Cookie", cookie)
      .send({ scope: "global", enabled: true })
      .expect(200);
    day = await getDay();
    expect(day.body.cleanup.smoothing).toMatchObject({ on: true, global: true, from: "global" });
    await request(app)
      .put("/api/v1/travtrack/cleanup/smoothing")
      .set("Cookie", cookie)
      .send({ scope: "day", date: "2026-10-12", enabled: false })
      .expect(200);
    day = await getDay();
    expect(day.body.cleanup.smoothing).toMatchObject({ on: false, global: true, from: "day" });
  });
});

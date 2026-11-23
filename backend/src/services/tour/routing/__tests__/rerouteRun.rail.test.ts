import request from "supertest";

import app from "../../../../index";
import { prisma } from "../../../../db";
import { clearJobs, settleAllJobs } from "../../../jobs/jobRegistry";
import { generateToken } from "../../../../utils/jwt";
import { hashPassword } from "../../../../utils/password";
import * as orr from "../../../rail/openRailRouting";
import { cancelRerouteRun, getRerouteRun, startRerouteRun } from "../rerouteRun";

/**
 * The rail scope of the bulk re-route: "Bahnstrecken neu routen". Each test
 * names the defect it guards: a pass touching lines that are not straight, a
 * drawn or traced line replaced, a failed router answer downgrading a stored
 * line, and the instance without a router drawing chords without saying why.
 */

jest.mock("../../../rail/openRailRouting", () => ({
  ...jest.requireActual("../../../rail/openRailRouting"),
  railRoutingBaseUrl: jest.fn(),
  routeRailLine: jest.fn(),
}));

const baseUrl = jest.mocked(orr.railRoutingBaseUrl);
const routeLine = jest.mocked(orr.routeRailLine);

const A = { lat: 52.52, lon: 13.4 };
const B = { lat: 50.11, lon: 8.68 };
const LINE: Array<[number, number]> = [
  [A.lon, A.lat],
  [11.2, 51.3],
  [B.lon, B.lat],
];

describe("bulk re-route, rail scope", () => {
  let userId: string;
  let adminId: string;
  let adminCookie: string;
  let userCookie: string;
  const deps = { pauseMs: () => 0 };

  const journey = (source: string, geometry?: Array<[number, number]>) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "A",
        depLat: A.lat,
        depLon: A.lon,
        arrStationName: "B",
        arrLat: B.lat,
        arrLon: B.lon,
        departureTime: new Date("2025-03-01T08:00:00Z"),
        geometrySource: source,
        geometry: geometry ?? undefined,
      },
    });
  const read = (id: string) => prisma.railJourney.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["railrr", "railrr-admin"] } } });
    userId = (
      await prisma.user.create({
        data: { username: "railrr", passwordHash: await hashPassword("x") },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: { username: "railrr-admin", passwordHash: await hashPassword("x"), isAdmin: true },
      })
    ).id;
    adminCookie = `auth_token=${generateToken(adminId)}`;
    userCookie = `auth_token=${generateToken(userId)}`;
  });
  beforeEach(() => {
    clearJobs();
    baseUrl.mockResolvedValue("http://orr.lan:8989");
    routeLine.mockReset();
  });
  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.rerouteRun.deleteMany({ where: { userId: { in: [userId, adminId] } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
  });

  const start = async (mode: "straight" | "all") => {
    const s = await startRerouteRun(adminId, { scope: "rail", routeId: null, mode }, deps);
    if (s.kind !== "started") throw new Error(s.kind);
    return s.run;
  };
  /** Start a pass and wait for its job to end; the run row is the answer. */
  const runToEnd = async (mode: "straight" | "all") => {
    const started = await start(mode);
    await settleAllJobs();
    return (await getRerouteRun(started.id, adminId))!;
  };

  it("routes only straight journeys and leaves traced, drawn and recorded lines alone", async () => {
    routeLine.mockResolvedValue({ ok: true, line: LINE, distanceKm: 500 } as never);
    const straight = await journey("straight");
    const traced = await journey("transitous", LINE);
    const drawn = await journey("manual", LINE);
    const routed = await journey("openrailrouting", LINE);
    const done = await runToEnd("straight");
    expect(done.status).toBe("done");
    expect(done.total).toBe(1);
    expect(done.routed).toBe(1);
    expect((await read(straight.id)).geometrySource).toBe("openrailrouting");
    expect((await read(traced.id)).geometrySource).toBe("transitous");
    expect((await read(drawn.id)).geometrySource).toBe("manual");
    expect((await read(routed.id)).geometrySource).toBe("openrailrouting");
    expect(routeLine).toHaveBeenCalledTimes(1);
  });

  it("'all' routes the router's own earlier lines again but still never a drawn or traced one", async () => {
    routeLine.mockResolvedValue({ ok: true, line: LINE, distanceKm: 500 } as never);
    await journey("straight");
    await journey("openrailrouting", LINE);
    await journey("manual", LINE);
    await journey("transitous", LINE);
    const done = await runToEnd("all");
    expect(done.total).toBe(2);
    expect(done.routed).toBe(2);
    expect(routeLine).toHaveBeenCalledTimes(2);
  });

  it("keeps the stored geometry when the router fails, and names the reason", async () => {
    routeLine.mockResolvedValue({ ok: false, reason: "noRoute" });
    const straight = await journey("straight");
    const old = await journey("openrailrouting", LINE);
    const done = await runToEnd("all");
    expect(done.status).toBe("done");
    expect(done.routed).toBe(0);
    expect(done.kept).toBe(2);
    expect(done.failureCounts).toEqual({ railRoutingNoRoute: 2 });
    expect((await read(straight.id)).geometrySource).toBe("straight");
    const kept = await read(old.id);
    expect(kept.geometrySource).toBe("openrailrouting");
    expect(kept.geometry).toEqual(LINE);
  });

  it("never swaps a stored tram line for the straight one when the router says no route", async () => {
    routeLine.mockResolvedValue({ ok: false, reason: "noRoute" });
    const tram = await prisma.railJourney.create({
      data: {
        userId,
        depStationName: "A",
        depLat: A.lat,
        depLon: A.lon,
        arrStationName: "B",
        arrLat: B.lat,
        arrLon: B.lon,
        departureTime: new Date("2025-03-01T08:00:00Z"),
        transitMode: "tram",
        geometrySource: "openrailrouting",
        geometry: LINE,
      },
    });
    const done = await runToEnd("all");
    expect(done.kept).toBe(1);
    const after = await read(tram.id);
    expect(after.geometrySource).toBe("openrailrouting");
    expect(after.geometry).toEqual(LINE);
  });

  it("does not overwrite a journey that became a drawn line after it was selected", async () => {
    const drawn = await journey("manual", LINE);
    const { routeRailJourneyAgain } = await import("../../../rail/railRouteAgain");
    routeLine.mockResolvedValue({ ok: true, line: LINE, distanceKm: 1 } as never);
    await expect(
      routeRailJourneyAgain(userId, drawn.id, { sources: ["straight"] })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(routeLine).not.toHaveBeenCalled();
    expect((await read(drawn.id)).geometrySource).toBe("manual");
  });

  it("stops as failed when the router stops answering instead of failing ride by ride", async () => {
    routeLine.mockResolvedValue({ ok: false, reason: "unavailable" });
    for (let i = 0; i < 7; i++) await journey("straight");
    const done = await runToEnd("straight");
    expect(done.status).toBe("failed");
    expect(done.stopReason).toBe("railRoutingUnavailable");
    expect(routeLine.mock.calls.length).toBeLessThan(7);
  });

  it("refuses to start without a rail router", async () => {
    baseUrl.mockResolvedValue(null);
    const s = await startRerouteRun(adminId, { scope: "rail", routeId: null, mode: "straight" });
    expect(s.kind).toBe("notConfigured");
  });

  it("is cancellable under its own scope and does not collide with a road run", async () => {
    routeLine.mockResolvedValue({ ok: true, line: LINE, distanceKm: 500 } as never);
    await journey("straight");
    const run = await start("straight");
    const road = await prisma.rerouteRun.create({
      data: { userId: adminId, scope: "instance", mode: "straight", status: "running" },
    });
    expect((await cancelRerouteRun(run.id, { scope: "instance" }))?.id).toBeUndefined();
    expect((await cancelRerouteRun(run.id, { scope: "rail" }))?.status).toBe("cancelled");
    expect(road.status).toBe("running");
  });

  describe("the admin endpoint and the noRouter reason", () => {
    it("counts straight rides for the readiness note and says whether a router is set", async () => {
      baseUrl.mockResolvedValue(null);
      await journey("straight");
      await journey("manual", LINE);
      const res = await request(app)
        .get("/api/v1/admin/instance-settings/routing/reroute-rail")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.routerConfigured).toBe(false);
      expect(res.body.straightJourneys).toBeGreaterThanOrEqual(1);
    });

    it("answers 409 notConfigured over HTTP without a router", async () => {
      baseUrl.mockResolvedValue(null);
      const res = await request(app)
        .post("/api/v1/admin/instance-settings/routing/reroute-rail")
        .set("Cookie", adminCookie)
        .send({ mode: "straight" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("notConfigured");
    });

    it("marks a straight journey noRouter on the detail while no router is set, and clears it after", async () => {
      const straight = await journey("straight");
      const drawn = await journey("manual", LINE);
      baseUrl.mockResolvedValue(null);
      const detail = (id: string) =>
        request(app).get(`/api/v1/rail/${id}`).set("Cookie", userCookie);
      expect((await detail(straight.id)).body.data.geometryReason).toBe("noRouter");
      expect((await detail(drawn.id)).body.data.geometryReason).toBeNull();
      baseUrl.mockResolvedValue("http://orr.lan:8989");
      expect((await detail(straight.id)).body.data.geometryReason).toBeNull();
      baseUrl.mockResolvedValue(null);
      const list = await request(app).get("/api/v1/rail").set("Cookie", userCookie);
      const row = list.body.data.find((r: { id: string }) => r.id === straight.id);
      expect(row.geometryReason).toBe("noRouter");
    });
  });
});

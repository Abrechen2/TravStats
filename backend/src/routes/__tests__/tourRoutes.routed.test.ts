jest.mock("../../services/tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import type { RouteProvider, RouteResult } from "../../services/tour/routing/types";

const mockResolveProvider = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;

/**
 * Task 6 (phase 3) — routing exposed over HTTP: a single leg routed through
 * the configured provider, and a whole section routed in one call.
 *
 * `resolveRouteProvider` is mocked at the module boundary so these tests
 * never touch the network — every "provider" here is a `jest.fn()` this
 * suite controls directly, exactly like `routeLegGeometry`'s own test suite
 * (task 5) does. `routeLegGeometry` itself is NOT mocked: its trustworthiness
 * checks (anchor tolerance, sanity ratio, finiteness) run for real against
 * whatever the fake provider returns, so a test's fake waypoints must
 * actually anchor at the real leg endpoints below.
 */
describe("Tour route sections — provider routing", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  let osloId: string;
  let kristiansandId: string;
  let bergenId: string;

  // Real-world coordinates so a provider "answer" anchored at them passes
  // routeLegGeometry's 1 km anchor check and its 20x sanity-ratio check.
  const OSLO = { lat: 59.91, lon: 10.75 };
  const KRISTIANSAND = { lat: 58.15, lon: 8.0 };
  const BERGEN = { lat: 60.39, lon: 5.32 };

  function fakeProvider(routeImpl: jest.Mock<Promise<RouteResult | null>>): RouteProvider {
    return { id: "graphhopper", route: routeImpl };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourrouting" } });
    const u = await prisma.user.create({
      data: { username: "tourrouting", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const oslo = await prisma.tripStop.create({
      data: { tripId, title: "Oslo", lat: OSLO.lat, lon: OSLO.lon },
    });
    const kristiansand = await prisma.tripStop.create({
      data: { tripId, title: "Kristiansand", lat: KRISTIANSAND.lat, lon: KRISTIANSAND.lon },
    });
    const bergen = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: BERGEN.lat, lon: BERGEN.lon },
    });
    osloId = oslo.id;
    kristiansandId = kristiansand.id;
    bergenId = bergen.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [osloId, kristiansandId, bergenId] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourrouting" } });
    await prisma.$disconnect();
  });

  const routeLegUrl = (from: string, to: string) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${from}/${to}/route`;
  const legUrl = (from: string, to: string) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${from}/${to}`;
  const routeAllUrl = () => `/api/v1/trips/${tripId}/routes/${routeId}/route-all`;

  it("routes a single leg through the configured provider and stores its geometry and distance", async () => {
    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [9.0, 59.0],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 350,
      drivingMinutes: 240,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("routed");
    expect(res.body.leg.confidence).toBe("high");
    expect(res.body.leg.distanceKm).toBe(350);
    expect(res.body.leg.drivingMinutes).toBe(240);
    expect(res.body.leg.waypoints).toEqual(line);
    expect(routeImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to route a leg when no provider is configured (409, not 400)", async () => {
    mockResolveProvider.mockResolvedValue(null);

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/configur/i);
  });

  it("a provider failure on a single leg leaves it a straight chord with low confidence, still 200", async () => {
    // The provider's own contract: null means "could not route this", never
    // a thrown error — see `routeLegGeometry`'s doc comment.
    const routeImpl = jest.fn().mockResolvedValue(null);
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("straight");
    expect(res.body.leg.confidence).toBe("low");
  });

  it("route-all routes every routable leg of a section and reports how many it skipped", async () => {
    // Mark the Kristiansand → Bergen leg as a ferry crossing, inside an
    // otherwise-road section — it must be skipped, not routed.
    await request(app)
      .put(legUrl(kristiansandId, bergenId))
      .set("Cookie", cookie)
      .send({ source: "straight", mode: "ferry" });

    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 320,
      drivingMinutes: 210,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

    expect(res.status).toBe(200);
    expect(res.body.routedCount).toBe(1);
    expect(res.body.skippedCount).toBe(1);
    // Only the road leg was ever handed to the provider.
    expect(routeImpl).toHaveBeenCalledTimes(1);

    const roadLeg = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId } },
    });
    expect(roadLeg.source).toBe("routed");
    expect(roadLeg.distanceKm).toBe(320);

    const ferryLeg = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: kristiansandId, toStopId: bergenId },
      },
    });
    expect(ferryLeg.source).toBe("straight");
    expect(ferryLeg.mode).toBe("ferry");
  });

  it("a provider failure during route-all leaves that leg a straight chord, and still answers 200 with an honest count", async () => {
    const routeImpl = jest.fn().mockResolvedValue(null);
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

    expect(res.status).toBe(200);
    // Both legs are road-mode by default, so both are attempted — the count
    // is honest about attempts, not about how many the provider actually
    // answered.
    expect(res.body.routedCount).toBe(2);
    expect(res.body.skippedCount).toBe(0);

    const legs = res.body.legs as Array<{ source: string; confidence: string }>;
    expect(legs.every((l) => l.source === "straight" && l.confidence === "low")).toBe(true);
  });

  it("rejects a leg override with source \"track\" and no trackId (400) — trackId is required, track itself is NOT refused", async () => {
    // Fix round 1: this test used to be titled "still rejects ... track ...
    // phase 3b owns producing it", from when `track` was not yet a valid
    // source at all. Phase 3b IS this task now, and `track` IS produced by
    // this same endpoint (see tourLegs.adopt.test.ts) — this 400 is ONLY
    // about the missing `trackId`, not about `track` being rejected
    // outright. The assertion below is written to actually distinguish the
    // two: a 400 whose Zod issue lands on `trackId` (this case) vs. one
    // that would land on `source` (a `track` rejected outright, the way
    // `routed` still is below) — asserting merely `res.status === 400`
    // would pass either way and prove nothing.
    const res = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "track" });

    expect(res.status).toBe(400);
    const details = res.body.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === "trackId")).toBe(true);
    expect(details.some((d) => d.field === "source")).toBe(false);
  });

  it("refuses a leg override with source \"routed\" (400) — that geometry comes from the routing endpoint, not this one", async () => {
    // Fix round 1: the manual override endpoint and the routing endpoint own
    // DIFFERENT source vocabularies now (MANUAL_LEG_SOURCES vs
    // ACCEPTED_LEG_SOURCES). A caller cannot hand-supply "routed" here.
    const res = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "routed" });

    expect(res.status).toBe(400);
    // The error handler puts Zod's per-field message in `details`, not the
    // top-level `error` string (which is always the generic "Validation error").
    const details = res.body.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === "source" && /route/i.test(d.message))).toBe(true);
  });

  it("a leg that was routed, then manually reverted to straight, ends up a consistent state — not a routed leg holding a chord", async () => {
    // Pins the actual harm fix round 1 closed: before the split, sending
    // source: "routed" through this endpoint (accepted then) without
    // waypoints cleared the stored line while the column kept saying
    // "routed" — a false provenance claim. Now the only way back from a
    // routed leg through this endpoint is source: "straight", and that must
    // leave EVERY field consistent: no leftover geometry, no leftover
    // routed distance, no leftover "routed" label.
    const original = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId },
      },
    });
    expect(original.source).toBe("straight");
    expect(original.waypoints).toBeNull();

    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 999,
      drivingMinutes: 300,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const routedRes = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();
    expect(routedRes.status).toBe(200);
    expect(routedRes.body.leg.source).toBe("routed");
    expect(routedRes.body.leg.distanceKm).toBe(999);

    const revertRes = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "straight" });

    expect(revertRes.status).toBe(200);
    expect(revertRes.body.leg.source).toBe("straight");
    expect(revertRes.body.leg.waypoints).toBeNull();
    expect(revertRes.body.leg.distanceKm).toBeCloseTo(original.distanceKm, 6);

    const persisted = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId },
      },
    });
    expect(persisted.source).toBe("straight");
    expect(persisted.waypoints).toBeNull();
    expect(persisted.distanceKm).toBeCloseTo(original.distanceKm, 6);
  });
});

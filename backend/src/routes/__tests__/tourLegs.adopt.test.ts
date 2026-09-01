import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Task 5 (Phase 3b tour tracks), Part C: adopting a leg's geometry from a
 * recorded track via `PUT /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId`.
 *
 * `adoptSegment` itself (Part A) is covered in
 * `services/tour/tracks/__tests__/adoptTrack.test.ts` — these tests are
 * about the HTTP boundary: ownership (a track from another user's route
 * must 404, not adopt), the honest 409 on a non-covering track (leaving the
 * leg untouched, never a silent fallback to a straight chord), and the Zod
 * boundary rejecting `{ source: "track" }` with no `trackId`.
 */
describe("Tour route legs — adopting a track", () => {
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let routeId: string;
  let osloId: string;
  let kristiansandId: string;

  // Same real-world coordinates the routing test suite uses, so a track
  // anchored at them is unambiguously "covering" this leg.
  const OSLO = { lat: 59.91, lon: 10.75 };
  const KRISTIANSAND = { lat: 58.15, lon: 8.0 };
  // Nowhere near Oslo/Kristiansand — a different trip's track entirely.
  const BERGEN = { lat: 60.39, lon: 5.32 };

  const coveringTrack: Array<[number, number]> = [
    [OSLO.lon, OSLO.lat],
    [9.0, 59.0],
    [KRISTIANSAND.lon, KRISTIANSAND.lat],
  ];
  const nonCoveringTrack: Array<[number, number]> = [
    [BERGEN.lon, BERGEN.lat],
    [5.4, 60.45],
  ];

  async function createTrack(
    forRouteId: string,
    geometry: Array<[number, number]>,
  ): Promise<string> {
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId: forRouteId,
        source: "gpx",
        name: "Test track",
        startedAt: new Date("2026-06-01T08:00:00Z"),
        endedAt: new Date("2026-06-01T09:00:00Z"),
        geometry: geometry as unknown as object,
        pointCount: geometry.length,
        distanceKm: 1,
      },
    });
    return track.id;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["touradopt", "touradoptother"] } } });

    const u = await prisma.user.create({
      data: { username: "touradopt", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "touradoptother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const oslo = await prisma.tripStop.create({
      data: { tripId, title: "Oslo", lat: OSLO.lat, lon: OSLO.lon },
    });
    const kristiansand = await prisma.tripStop.create({
      data: { tripId, title: "Kristiansand", lat: KRISTIANSAND.lat, lon: KRISTIANSAND.lon },
    });
    osloId = oslo.id;
    kristiansandId = kristiansand.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [osloId, kristiansandId] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["touradopt", "touradoptother"] } } });
    await prisma.$disconnect();
  });

  const legUrl = () => `/api/v1/trips/${tripId}/routes/${routeId}/legs/${osloId}/${kristiansandId}`;

  it("adopts a covering track: stores the segment and the measured distance", async () => {
    const trackId = await createTrack(routeId, coveringTrack);

    const res = await request(app).put(legUrl()).set("Cookie", cookie).send({ source: "track", trackId });

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("track");
    expect(res.body.leg.confidence).toBe("high");
    expect(res.body.leg.waypoints).toEqual(coveringTrack);
    // Measured on the adopted segment (the whole track here), not a chord.
    expect(res.body.leg.distanceKm).toBeGreaterThan(0);

    const stored = await prisma.tripRouteLeg.findUnique({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId } },
    });
    expect(stored?.source).toBe("track");
    expect(stored?.waypoints).toEqual(coveringTrack);
  });

  it("a track leg cannot smuggle waypoints through the request body — the stored geometry is the adopted segment, never the supplied line", async () => {
    // LOW fix round 1: the single most important property the discriminated
    // union exists to provide is one leg, one source of truth for its
    // geometry. `trackLegShape` (schemas/tour.ts) has no `waypoints` field
    // at all, so zod silently strips one if a caller attaches it — but that
    // guarantee is worthless unless something actually asserts the STORED
    // leg ends up with the adopted segment, not the decoy. A decoy far away
    // from both stops makes the two cases unmistakably different: if the
    // decoy leaked through, `waypoints` would equal it and `distanceKm`
    // would be wildly wrong for this leg.
    const trackId = await createTrack(routeId, coveringTrack);
    // Reuses nonCoveringTrack as the decoy line — any waypoints would do,
    // but this one is convenient: already declared, and far enough from
    // both stops that if it leaked through, distanceKm would be wildly
    // wrong for this leg too.
    const decoyWaypoints = nonCoveringTrack;

    const res = await request(app)
      .put(legUrl())
      .set("Cookie", cookie)
      .send({ source: "track", trackId, waypoints: decoyWaypoints });

    expect(res.status).toBe(200);
    expect(res.body.leg.waypoints).toEqual(coveringTrack);
    expect(res.body.leg.waypoints).not.toEqual(decoyWaypoints);

    const stored = await prisma.tripRouteLeg.findUnique({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId } },
    });
    expect(stored?.waypoints).toEqual(coveringTrack);
    expect(stored?.waypoints).not.toEqual(decoyWaypoints);
  });

  it("a non-covering track 409s and leaves the leg completely unchanged", async () => {
    // Establish a known baseline: a plain straight chord, exactly what a
    // freshly-assigned leg starts as.
    await request(app)
      .delete(legUrl())
      .set("Cookie", cookie)
      .send();
    const before = await prisma.tripRouteLeg.findUnique({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId } },
    });
    expect(before?.source).toBe("straight");

    const trackId = await createTrack(routeId, nonCoveringTrack);

    const res = await request(app).put(legUrl()).set("Cookie", cookie).send({ source: "track", trackId });

    expect(res.status).toBe(409);
    expect(String(res.body.error ?? "")).toMatch(/\d/); // names the anchor tolerance (a number)

    const after = await prisma.tripRouteLeg.findUnique({
      where: { routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId } },
    });
    expect(after?.source).toBe(before?.source);
    expect(after?.distanceKm).toBe(before?.distanceKm);
    expect(after?.waypoints).toEqual(before?.waypoints);
  });

  it("a trackId belonging to a DIFFERENT route 404s rather than adopting", async () => {
    const otherTrip = await prisma.trip.create({ data: { userId: (await prisma.user.findUniqueOrThrow({ where: { username: "touradoptother" } })).id, name: "Other" } });
    const otherRoute = await prisma.tripRoute.create({
      data: { tripId: otherTrip.id, name: "Other section", mode: "road" },
    });
    const foreignTrackId = await createTrack(otherRoute.id, coveringTrack);

    const res = await request(app)
      .put(legUrl())
      .set("Cookie", cookie)
      .send({ source: "track", trackId: foreignTrackId });

    expect(res.status).toBe(404);
  });

  it("{ source: \"track\" } with no trackId is a 400 from Zod, not a 500", async () => {
    const res = await request(app).put(legUrl()).set("Cookie", cookie).send({ source: "track" });

    expect(res.status).toBe(400);
  });

  it("a trackId that doesn't exist at all 404s the same way", async () => {
    const res = await request(app)
      .put(legUrl())
      .set("Cookie", cookie)
      .send({ source: "track", trackId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(404);
  });
});

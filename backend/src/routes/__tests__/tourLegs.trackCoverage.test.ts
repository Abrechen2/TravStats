import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET …/legs/track-coverage` — the server's answer to "which recording
 * covers this leg", which the tour editor now displays instead of computing
 * (board item `tour-track-coverage-server-side`). The property that matters is
 * agreement: the leg the endpoint calls covered must be the leg the adoption
 * `PUT` accepts, and the one it refuses must 409 there too.
 */
describe("Tour route legs — track coverage decided by the server", () => {
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let routeId: string;
  let osloId: string;
  let kristiansandId: string;

  const OSLO = { lat: 59.91, lon: 10.75 };
  const KRISTIANSAND = { lat: 58.15, lon: 8.0 };

  async function createTrack(
    geometry: Array<[number, number]>,
    startedAt: string,
    segmentStarts: number[] | null = null
  ): Promise<string> {
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId,
        source: "gpx",
        startedAt: new Date(startedAt),
        endedAt: new Date(startedAt),
        geometry: geometry as unknown as object,
        ...(segmentStarts ? { segmentStarts } : {}),
        pointCount: geometry.length,
        distanceKm: 1,
      },
    });
    return track.id;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcov", "tourcovother"] } } });
    const u = await prisma.user.create({
      data: { username: "tourcov", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    const other = await prisma.user.create({
      data: { username: "tourcovother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({
      data: { userId: u.id, tripId, name: "S", mode: "road" },
    });
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

  afterEach(async () => {
    await prisma.tripRouteTrack.deleteMany({ where: { routeId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcov", "tourcovother"] } } });
    await prisma.$disconnect();
  });

  const coverage = (as = cookie, path = `/api/v1/trips/${tripId}/routes/${routeId}`) =>
    request(app).get(`${path}/legs/track-coverage`).set("Cookie", as);
  const adopt = (trackId: string) =>
    request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/legs/${osloId}/${kristiansandId}`)
      .set("Cookie", cookie)
      .send({ source: "track", trackId });

  it("answers null per leg for a section without recordings", async () => {
    const res = await coverage();
    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual([
      { legId: expect.any(String), fromStopId: osloId, toStopId: kristiansandId, verdict: null },
    ]);
  });

  it("names the covering recording, and the adoption accepts exactly that one", async () => {
    await createTrack(
      [
        [5.32, 60.39],
        [5.4, 60.45],
      ],
      "2026-06-01T07:00:00Z"
    );
    const covering = await createTrack(
      [
        [OSLO.lon, OSLO.lat],
        [9.0, 59.0],
        [KRISTIANSAND.lon, KRISTIANSAND.lat],
      ],
      "2026-06-01T08:00:00Z"
    );
    const res = await coverage();
    expect(res.body.coverage[0].verdict).toEqual({
      trackId: covering,
      status: "covered",
      reason: "complete",
    });
    expect((await adopt(covering)).status).toBe(200);
    // The same answer on the trip-less path.
    const standalone = await coverage(cookie, `/api/v1/tours/${routeId}`);
    expect(standalone.body.coverage[0].verdict.trackId).toBe(covering);
  });

  it("refuses a recording with a hole between the stops — as the adoption's 409 does", async () => {
    // The browser check this replaced ignored segment boundaries, so it
    // offered `track` here and the server then refused it.
    const gappy = await createTrack(
      [
        [OSLO.lon, OSLO.lat],
        [9.5, 59.5],
        [8.5, 58.5],
        [KRISTIANSAND.lon, KRISTIANSAND.lat],
      ],
      "2026-06-01T08:00:00Z",
      [0, 2]
    );
    const res = await coverage();
    expect(res.body.coverage[0].verdict).toEqual({
      trackId: gappy,
      status: "notCovered",
      reason: "recordingGap",
    });
    expect((await adopt(gappy)).status).toBe(409);
  });

  it("does not answer for another user's section", async () => {
    await createTrack(
      [
        [OSLO.lon, OSLO.lat],
        [KRISTIANSAND.lon, KRISTIANSAND.lat],
      ],
      "2026-06-01T08:00:00Z"
    );
    const res = await coverage(otherCookie);
    expect(res.status).toBe(404);
    expect(res.body.coverage).toBeUndefined();
  });
});

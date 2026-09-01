import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * DELETE /trips/:id/stops/:stopId used to leave a section's legs and
 * `routeOrderIdx` behind: the FK cascade removes both legs touching the
 * deleted stop, nothing re-creates the leg that should now span its
 * former neighbours, and the surviving members keep their old,
 * non-contiguous `routeOrderIdx`. A section A→B→C lost B and was left
 * with two stops and zero legs — the UI then showed 0 km where it showed
 * 340. This suite pins the recompute that closes that gap.
 */
describe("DELETE /trips/:id/stops/:stopId recomputes its section", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstopdelete" } });
    const u = await prisma.user.create({
      data: { username: "tourstopdelete", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstopdelete" } });
    await prisma.$disconnect();
  });

  it("bridges A-B-C into one A-C leg, distance > 0, orderIdx [0,1]", async () => {
    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Südnorwegen", mode: "road" },
    });

    const places: Array<[string, number, number]> = [
      ["kristiansand", 58.15, 8.0],
      ["bergen", 60.39, 5.32],
      ["oslo", 59.91, 10.75],
    ];
    const stops: Record<string, string> = {};
    for (const [key, lat, lon] of places) {
      const s = await prisma.tripStop.create({ data: { tripId, title: key, lat, lon } });
      stops[key] = s.id;
    }

    const assign = await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${route.id}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [stops.kristiansand, stops.bergen, stops.oslo] });
    expect(assign.status).toBe(200);
    expect(assign.body.legs).toHaveLength(2);

    const del = await request(app)
      .delete(`/api/v1/trips/${tripId}/stops/${stops.bergen}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);

    const detail = await request(app)
      .get(`/api/v1/trips/${tripId}/routes/${route.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);

    expect(
      detail.body.stops.map((s: { routeOrderIdx: number }) => s.routeOrderIdx),
    ).toEqual([0, 1]);

    expect(detail.body.legs).toHaveLength(1);
    const leg = detail.body.legs[0];
    expect(leg.fromStopId).toBe(stops.kristiansand);
    expect(leg.toStopId).toBe(stops.oslo);
    expect(leg.distanceKm).toBeGreaterThan(0);

    // Bergen itself is gone, not merely released.
    const bergen = await prisma.tripStop.findUnique({ where: { id: stops.bergen } });
    expect(bergen).toBeNull();
  });

  it("does no extra work for a stop with no routeId", async () => {
    const stop = await prisma.tripStop.create({
      data: { tripId, title: "restaurant", lat: 1, lon: 1 },
    });

    const res = await request(app)
      .delete(`/api/v1/trips/${tripId}/stops/${stop.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.tripStop.findUnique({ where: { id: stop.id } })).toBeNull();
  });
});

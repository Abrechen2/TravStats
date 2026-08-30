import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — stop assignment", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  const stopIds: Record<string, string> = {};

  const put = (ids: string[]) =>
    request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: ids });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstops" } });
    const u = await prisma.user.create({
      data: { username: "tourstops", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    tripId = trip.id;

    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Südnorwegen", mode: "road" },
    });
    routeId = route.id;

    const places: Array<[string, number, number]> = [
      ["kristiansand", 58.15, 8.0],
      ["bergen", 60.39, 5.32],
      ["lom", 61.84, 8.57],
      ["oslo", 59.91, 10.75],
    ];
    for (const [key, lat, lon] of places) {
      const s = await prisma.tripStop.create({ data: { tripId, title: key, lat, lon } });
      stopIds[key] = s.id;
    }
    const noCoords = await prisma.tripStop.create({ data: { tripId, title: "restaurant" } });
    stopIds.restaurant = noCoords.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstops" } });
    await prisma.$disconnect();
  });

  it("assigns stops, renumbers from zero and derives one leg per pair", async () => {
    const res = await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);

    expect(res.status).toBe(200);
    expect(res.body.stops.map((s: { routeOrderIdx: number }) => s.routeOrderIdx)).toEqual([0, 1, 2]);
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.route.distanceKm).toBeGreaterThan(0);
    for (const leg of res.body.legs) {
      expect(leg.source).toBe("straight");
      expect(leg.mode).toBe("road");
    }
  });

  it("refuses a stop without coordinates", async () => {
    const res = await put([stopIds.kristiansand, stopIds.restaurant]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/coordinate/i);

    const stop = await prisma.tripStop.findUnique({ where: { id: stopIds.restaurant } });
    expect(stop?.routeId).toBeNull();
  });

  it("refuses a stop that belongs to a different trip", async () => {
    const otherTrip = await prisma.trip.create({ data: { userId, name: "Andere" } });
    const foreign = await prisma.tripStop.create({
      data: { tripId: otherTrip.id, title: "fremd", lat: 1, lon: 1 },
    });
    const res = await put([stopIds.kristiansand, foreign.id]);
    expect(res.status).toBe(400);
  });

  it("refuses a stop that already belongs to a different route section", async () => {
    const otherRoute = await prisma.tripRoute.create({
      data: { tripId, name: "Anderer Abschnitt", mode: "road" },
    });
    await prisma.tripStop.update({
      where: { id: stopIds.bergen },
      data: { routeId: otherRoute.id, routeOrderIdx: 0 },
    });

    const res = await put([stopIds.kristiansand, stopIds.bergen]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/already belongs to another route section/i);

    // Nothing was written: the stop still belongs to its original section.
    const stop = await prisma.tripStop.findUnique({ where: { id: stopIds.bergen } });
    expect(stop?.routeId).toBe(otherRoute.id);
    expect(stop?.routeOrderIdx).toBe(0);
  });

  it("keeps a hand-drawn line when an unrelated stop is inserted", async () => {
    await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);

    const line: Array<[number, number]> = [
      [8.0, 58.15],
      [7.0, 59.2],
      [5.32, 60.39],
    ];
    const override = await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/legs/${stopIds.kristiansand}/${stopIds.bergen}`)
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: line });
    expect(override.status).toBe(200);
    const drawnKm = override.body.leg.distanceKm as number;

    // Insert Lom between Bergen and Oslo — the Kristiansand→Bergen line must
    // survive untouched. This is the endpoint-keying promise.
    const after = await put([stopIds.kristiansand, stopIds.bergen, stopIds.lom, stopIds.oslo]);
    const survivor = after.body.legs.find(
      (l: { fromStopId: string }) => l.fromStopId === stopIds.kristiansand,
    );
    expect(survivor.source).toBe("drawn");
    expect(survivor.distanceKm).toBeCloseTo(drawnKm, 6);
    expect(after.body.legs).toHaveLength(3);
  });

  it("releases a removed stop without deleting it", async () => {
    await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);
    const res = await put([stopIds.kristiansand, stopIds.oslo]);

    expect(res.body.legs).toHaveLength(1);
    const released = await prisma.tripStop.findUnique({ where: { id: stopIds.bergen } });
    expect(released).not.toBeNull();
    expect(released?.routeId).toBeNull();
    expect(released?.routeOrderIdx).toBeNull();
  });

  it("accepts an empty list and clears the section", async () => {
    await put([stopIds.kristiansand, stopIds.bergen]);
    const res = await put([]);
    expect(res.status).toBe(200);
    expect(res.body.legs).toEqual([]);
    expect(res.body.route.distanceKm).toBe(0);
    expect(await prisma.tripStop.count({ where: { tripId } })).toBe(5);
  });

  it("models a loop as two distinct stops at the same place", async () => {
    // A stop id may not repeat — routeOrderIdx is one Int per stop, so a
    // loop is expressed as a SECOND stop at the same coordinates, not the
    // same id listed twice.
    const back = await prisma.tripStop.create({
      data: { tripId, title: "lom-back", lat: 61.84, lon: 8.57 },
    });
    const res = await put([stopIds.lom, stopIds.bergen, back.id]);
    expect(res.status).toBe(200);
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.stops.map((s: { routeOrderIdx: number }) => s.routeOrderIdx)).toEqual([0, 1, 2]);
  });

  it("refuses the same stop twice", async () => {
    const res = await put([stopIds.lom, stopIds.bergen, stopIds.lom]);
    expect(res.status).toBe(400);
  });

  it("rejects a stop stolen after the pre-check but before commit (race backstop)", async () => {
    // Decision 1's up-front check reads on the plain client, before the
    // transaction opens — it is check-then-act and can lose a race: a
    // concurrent PUT on a sibling section could assign the same stop
    // between that read and this request's write. Simulated deterministically
    // here (rather than with real concurrent requests, whose interleaving
    // isn't controllable) by hooking the pre-check's own read: right after
    // it resolves with the stop still unassigned, a second "request" steals
    // Bergen for another section before this request's transaction runs.
    const otherRoute = await prisma.tripRoute.create({
      data: { tripId, name: "Konkurrent", mode: "road" },
    });

    const originalFindMany = prisma.tripStop.findMany.bind(prisma.tripStop);
    const spy = jest
      .spyOn(prisma.tripStop, "findMany")
      .mockImplementationOnce(async (...args: Parameters<typeof prisma.tripStop.findMany>) => {
        const result = await originalFindMany(...args);
        await prisma.tripStop.update({
          where: { id: stopIds.bergen },
          data: { routeId: otherRoute.id, routeOrderIdx: 0 },
        });
        return result;
      });

    try {
      const res = await put([stopIds.kristiansand, stopIds.bergen]);
      expect(res.status).toBe(409);

      // Atomic: the transaction rolled back, so Kristiansand — assigned
      // before the loop reached the stolen stop — was NOT left assigned.
      const kris = await prisma.tripStop.findUnique({ where: { id: stopIds.kristiansand } });
      expect(kris?.routeId).toBeNull();

      // Bergen still belongs to whichever section actually won the race.
      const bergen = await prisma.tripStop.findUnique({ where: { id: stopIds.bergen } });
      expect(bergen?.routeId).toBe(otherRoute.id);
    } finally {
      spy.mockRestore();
    }
  });
});

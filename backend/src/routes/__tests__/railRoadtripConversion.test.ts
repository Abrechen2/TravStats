import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * "Als Bahnfahrt übernehmen" (owner decision 1 of the rail spec): a roadtrip
 * section stored by rail becomes one rail journey per leg. What matters most
 * is what a client cannot see — whose section a request may convert, that a
 * second run writes nothing twice, and that the section goes only when the
 * user confirmed it and every leg became a ride.
 */

const USERS = ["railconvert", "railconvertstranger"];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("POST /rail/roadtrip-conversion/:routeId", () => {
  let cookie: string;
  let userId: string;
  let strangerCookie: string;
  let tripId: string;

  const url = (id: string) => `/api/v1/rail/roadtrip-conversion/${id}`;

  /** München → Wien (straight) → Budapest (drawn), the first stop on the trip's timeline. */
  async function railSection(vehicle = "rail", firstDay: string | null = "2025-07-03") {
    const route = await prisma.tripRoute.create({
      data: { userId, tripId, name: "Interrail 2025", mode: "rail", kind: "roadtrip", vehicle },
    });
    const stop = (title: string, lat: number, lon: number, i: number, over = {}) =>
      prisma.tripStop.create({
        data: { title, lat, lon, routeId: route.id, routeOrderIdx: i, domain: "roadtrip", ...over },
      });
    const a = await stop("München Hbf", 48.1402, 11.5586, 0, {
      tripId,
      endDate: firstDay ? day(firstDay) : null,
    });
    const b = await stop("Wien Hbf", 48.1852, 16.3776, 1, {
      startDate: day("2025-07-03"),
      endDate: day("2025-07-05"),
    });
    const c = await stop("Budapest-Keleti", 47.5003, 19.0838, 2, { startDate: day("2025-07-05") });
    await prisma.tripRouteLeg.createMany({
      data: [
        {
          routeId: route.id,
          fromStopId: a.id,
          toStopId: b.id,
          distanceKm: 355,
          source: "straight",
          mode: "rail",
        },
        {
          routeId: route.id,
          fromStopId: b.id,
          toStopId: c.id,
          distanceKm: 243.5,
          source: "drawn",
          mode: "rail",
          waypoints: [
            [16.3776, 48.1852],
            [17.9, 47.9],
            [19.0838, 47.5003],
          ],
        },
      ],
    });
    return { routeId: route.id, borrowedStopId: a.id };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const s = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    strangerCookie = `auth_token=${generateToken(s.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Balkan per Zug" } })).id;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.tripStop.deleteMany({ where: { tripId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("previews one ride per leg, in route order, and writes nothing", async () => {
    const { routeId } = await railSection();
    const res = await request(app).get(url(routeId)).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ canRemoveSection: true, skipped: [] });
    expect(
      res.body.data.rides.map(
        (r: { departureStationName: string; arrivalStationName: string; departureDay: string }) =>
          `${r.departureStationName} → ${r.arrivalStationName} ${r.departureDay}`
      )
    ).toEqual(["München Hbf → Wien Hbf 2025-07-03", "Wien Hbf → Budapest-Keleti 2025-07-05"]);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("writes the rides through the rail rules and keeps the section unless asked", async () => {
    const { routeId } = await railSection();
    const res = await request(app).post(url(routeId)).set("Cookie", cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, alreadyConverted: 0, sectionRemoved: false });

    const rides = await prisma.railJourney.findMany({
      where: { userId },
      orderBy: { departureTime: "asc" },
    });
    expect(rides).toHaveLength(2);
    const [straight, drawn] = rides;
    // Noon on München's clock in July is 10:00 UTC; the arrival is not known.
    expect(straight.departureTime.toISOString()).toBe("2025-07-03T10:00:00.000Z");
    expect(straight).toMatchObject({
      tripId,
      arrivalTime: null,
      depCountry: "DE",
      arrCountry: "AT",
      depTimezone: "Europe/Berlin",
      geometrySource: "straight",
      distanceSource: "great_circle",
      status: "completed",
    });
    expect(straight.notes).toContain("placeholder at noon");
    expect(drawn).toMatchObject({
      geometrySource: "manual",
      distanceSource: "route",
      distanceKm: 243.5,
    });
    expect(drawn.geometry).toHaveLength(3);
    expect(await prisma.tripRoute.count({ where: { id: routeId } })).toBe(1);
  });

  it("writes nothing twice, and removes the section only when told to", async () => {
    const { routeId, borrowedStopId } = await railSection();
    await request(app).post(url(routeId)).set("Cookie", cookie).send({}).expect(200);

    const again = await request(app)
      .post(url(routeId))
      .set("Cookie", cookie)
      .send({ removeSection: true });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({
      created: 0,
      alreadyConverted: 2,
      sectionRemoved: true,
    });
    expect(again.body.data.journeyIds).toHaveLength(2);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(2);
    expect(await prisma.tripRoute.count({ where: { id: routeId } })).toBe(0);
    // The stop the section borrowed from the trip's timeline goes back to it.
    expect(await prisma.tripStop.findUnique({ where: { id: borrowedStopId } })).toMatchObject({
      tripId,
      routeId: null,
    });
  });

  it("keeps the section when a leg cannot become a ride, and says which", async () => {
    const { routeId } = await railSection("rail", null);
    const preview = await request(app).get(url(routeId)).set("Cookie", cookie);
    expect(preview.body.data.canRemoveSection).toBe(false);
    expect(preview.body.data.skipped.map((s: { reason: string }) => s.reason)).toEqual(["noDate"]);

    const refused = await request(app)
      .post(url(routeId))
      .set("Cookie", cookie)
      .send({ removeSection: true });
    expect(refused.status).toBe(409);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
    expect(await prisma.tripRoute.count({ where: { id: routeId } })).toBe(1);
  });

  it("refuses a roadtrip that is not by rail", async () => {
    const { routeId } = await railSection("motorhome");
    const res = await request(app).post(url(routeId)).set("Cookie", cookie).send({});
    expect(res.status).toBe(409);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("answers another account's roadtrip as missing and touches nothing", async () => {
    const { routeId } = await railSection();
    const peek = await request(app).get(url(routeId)).set("Cookie", strangerCookie);
    expect(peek.status).toBe(404);
    const take = await request(app)
      .post(url(routeId))
      .set("Cookie", strangerCookie)
      .send({ removeSection: true });
    expect(take.status).toBe(404);
    expect(await prisma.railJourney.count()).toBe(
      await prisma.railJourney.count({
        where: { NOT: { externalRef: { startsWith: "roadtrip:" } } },
      })
    );
    expect(await prisma.tripRoute.count({ where: { id: routeId } })).toBe(1);
  });

  it("refuses an unknown body field rather than guessing what it meant", async () => {
    const { routeId } = await railSection();
    const res = await request(app)
      .post(url(routeId))
      .set("Cookie", cookie)
      .send({ deleteSection: true });
    expect(res.status).toBe(400);
  });
});

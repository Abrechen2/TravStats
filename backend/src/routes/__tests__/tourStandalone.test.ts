import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A tour that belongs to no trip (owner ruling, 2026-09-21: "Sie können
 * auch einzeln leben").
 *
 * Everything here is about the two things that change when the trip goes
 * away: who proves ownership, and where the points come from.
 */
describe("a standalone tour", () => {
  const names = ["tourstandalone", "tourstandaloneother"];
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: names } } });

    const u = await prisma.user.create({
      data: { username: names[0], passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    userId = u.id;

    const other = await prisma.user.create({
      data: { username: names[1], passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Norwegen" } });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: names } } });
    await prisma.$disconnect();
  });

  async function createStandalone(name = "Besseggen"): Promise<string> {
    const res = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name, mode: "foot" });
    expect(res.status).toBe(201);
    expect(res.body.route.tripId).toBeNull();
    return res.body.route.id as string;
  }

  it("is created with no trip, and the list shows it with no trip name", async () => {
    const id = await createStandalone();

    const list = await request(app).get("/api/v1/tours").set("Cookie", cookie);
    expect(list.status).toBe(200);
    const mine = list.body.tours.find((t: { id: string }) => t.id === id);
    // `tripName` used to be read off a relation that was mandatory. A tour
    // with no trip has no name to show there, and null is the answer — not
    // an invented one, and not the tour missing from the list entirely.
    expect(mine).toMatchObject({ tripId: null, tripName: null });
  });

  it("is listed for its owner even though no trip vouches for it", async () => {
    await createStandalone("Nur meine");

    const mine = await request(app).get("/api/v1/tours").set("Cookie", cookie);
    const theirs = await request(app).get("/api/v1/tours").set("Cookie", otherCookie);

    expect(mine.body.tours.some((t: { name: string }) => t.name === "Nur meine")).toBe(true);
    expect(theirs.body.tours).toHaveLength(0);
  });

  it("is reached without a trip in the path, and is refused to a stranger", async () => {
    const id = await createStandalone();

    const ok = await request(app).get(`/api/v1/tours/${id}`).set("Cookie", cookie);
    expect(ok.status).toBe(200);

    const no = await request(app).get(`/api/v1/tours/${id}`).set("Cookie", otherCookie);
    expect(no.status).toBe(404);
  });

  it("refuses a section of trip A reached through trip B's path", async () => {
    const otherTrip = await prisma.trip.create({
      data: { userId, name: "Zweite Reise" },
    });
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Auf Reise eins", mode: "road" });

    // Both trips are the same person's, which is exactly the case where a
    // missing check would never be noticed.
    const res = await request(app)
      .get(`/api/v1/trips/${otherTrip.id}/routes/${created.body.route.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("takes its points directly, renumbers them, and computes legs", async () => {
    const id = await createStandalone("Mit Punkten");

    const res = await request(app)
      .put(`/api/v1/tours/${id}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "Gjendesheim", lat: 61.4948, lon: 8.8054 },
          { title: "Besseggen", lat: 61.5024, lon: 8.7311 },
          { title: "Memurubu", lat: 61.5155, lon: 8.6541 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.stops.map((s: { routeOrderIdx: number }) => s.routeOrderIdx)).toEqual([
      0, 1, 2,
    ]);
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.route.distanceKm).toBeGreaterThan(0);
  });

  it("removes the points a new list leaves out, rather than stranding them", async () => {
    const id = await createStandalone("Kürzer");
    await request(app)
      .put(`/api/v1/tours/${id}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "A", lat: 10, lon: 10 },
          { title: "B", lat: 11, lon: 11 },
        ],
      });

    const shortened = await request(app)
      .put(`/api/v1/tours/${id}/points`)
      .set("Cookie", cookie)
      .send({ points: [{ title: "A", lat: 10, lon: 10 }] });

    expect(shortened.status).toBe(200);
    expect(shortened.body.stops).toHaveLength(1);
    // A released point of a standalone tour has no timeline to fall back
    // to: left behind it would belong to nobody, which the CHECK in the
    // migration refuses to store in the first place.
    const stranded = await prisma.tripStop.count({ where: { tripId: null, routeId: null } });
    expect(stranded).toBe(0);
  });

  it("refuses the points endpoint on a tour that belongs to a trip", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Gehört zur Reise", mode: "road" });

    const res = await request(app)
      .put(`/api/v1/tours/${created.body.route.id}/points`)
      .set("Cookie", cookie)
      .send({ points: [{ title: "X", lat: 1, lon: 1 }] });

    // Not a quiet success: the trip's own stops are the vertices there, and
    // writing a second, trip-less copy of one is the duplicate this split
    // exists to avoid.
    expect(res.status).toBe(409);
  });

  it("deletes its own points with it, and leaves a trip's stops alone", async () => {
    const standalone = await createStandalone("Wird gelöscht");
    await request(app)
      .put(`/api/v1/tours/${standalone}/points`)
      .set("Cookie", cookie)
      .send({ points: [{ title: "Weg", lat: 5, lon: 5 }] });

    const del = await request(app).delete(`/api/v1/tours/${standalone}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
    expect(await prisma.tripStop.count({ where: { title: "Weg" } })).toBe(0);

    // The trip case is the promise the delete confirmation makes: a tour is
    // scaffolding over the timeline, and removing it must not remove the
    // timeline.
    const onTrip = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Mit Stopps", mode: "road" });
    const stop = await prisma.tripStop.create({
      data: { tripId, title: "Bleibt", lat: 6, lon: 6 },
    });
    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${onTrip.body.route.id}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [stop.id] });

    await request(app)
      .delete(`/api/v1/trips/${tripId}/routes/${onTrip.body.route.id}`)
      .set("Cookie", cookie);

    const survivor = await prisma.tripStop.findUnique({ where: { id: stop.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.routeId).toBeNull();
  });
});

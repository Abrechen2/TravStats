import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Roadtrips (design 2026-09-24 §3–4, §8): the station states, stay
 * ownership, nights counted once, what a deleted stay leaves behind, day
 * tours anchored at a station, and moving rows between the two pages.
 */

const USERS = ["roadtripper", "roadtripstranger"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("Roadtrips", () => {
  let cookie: string;
  let userId: string;
  let strangerCookie: string;
  let strangerStayId: string;
  let campStayId: string;
  let roadtripId: string;

  async function makeStay(ownerId: string, name: string, checkIn: string, checkOut: string) {
    const lodging = await prisma.lodging.create({
      data: { userId: ownerId, name, type: "campsite", lat: 58.9, lon: 5.7 },
    });
    const stay = await prisma.lodgingStay.create({
      data: { lodgingId: lodging.id, userId: ownerId, checkIn: d(checkIn), checkOut: d(checkOut) },
    });
    return stay.id;
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
    strangerStayId = await makeStay(s.id, "Fremder Platz", "2026-07-12", "2026-07-14");
    campStayId = await makeStay(u.id, "Mosvangen Camping", "2026-07-14", "2026-07-16");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  const stations = (id = roadtripId) =>
    request(app).put(`/api/v1/roadtrips/${id}/stations`).set("Cookie", cookie);

  it("creates a roadtrip that the tour list does not show as a tour", async () => {
    const res = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Norwegen mit dem Wohnmobil", vehicle: "motorhome", vehicleName: "Der Dicke" });
    expect(res.status).toBe(201);
    expect(res.body.roadtrip).toMatchObject({
      kind: "roadtrip",
      mode: "road",
      vehicle: "motorhome",
      kindAssignedAutomatically: false,
    });
    roadtripId = res.body.roadtrip.id;

    const tours = await request(app).get("/api/v1/tours?kind=tour").set("Cookie", cookie);
    expect(tours.body.tours.map((t: { id: string }) => t.id)).not.toContain(roadtripId);
    const roadtrips = await request(app).get("/api/v1/tours?kind=roadtrip").set("Cookie", cookie);
    expect(roadtrips.body.tours.map((t: { id: string }) => t.id)).toContain(roadtripId);
  });

  it("stores three stations in their three states and counts each night once", async () => {
    const res = await stations().send({
      stations: [
        {
          title: "Hamburg",
          lat: 53.55,
          lon: 9.99,
          startDate: "2026-07-12",
          night: { kind: "pass" },
        },
        {
          title: "Stavanger",
          lat: 58.97,
          lon: 5.73,
          startDate: "2026-07-14",
          endDate: "2026-07-16",
          night: { kind: "stay", lodgingStayId: campStayId },
        },
        {
          title: "bei Odda",
          lat: 60.07,
          lon: 6.55,
          startDate: "2026-07-16",
          endDate: "2026-07-17",
          night: { kind: "free" },
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.stations.map((s: { state: string }) => s.state)).toEqual([
      "pass",
      "stay",
      "free",
    ]);
    expect(res.body.stations[1].stay).toMatchObject({
      lodgingName: "Mosvangen Camping",
      lodgingType: "campsite",
    });
    expect(res.body.nights).toEqual({
      stayNights: 2,
      freeNights: 1,
      nights: 3,
      nightsKnown: true,
      placesSlept: 2,
    });
    expect(res.body.legs).toHaveLength(2);
  });

  it("refuses a stay that belongs to someone else", async () => {
    const res = await stations().send({
      stations: [
        {
          title: "Fremd",
          lat: 58.9,
          lon: 5.7,
          night: { kind: "stay", lodgingStayId: strangerStayId },
        },
      ],
    });
    expect(res.status).toBe(404);
  });

  it("refuses a station that mixes its states", async () => {
    const res = await stations().send({
      stations: [
        { title: "X", lat: 58.9, lon: 5.7, night: { kind: "pass", lodgingStayId: campStayId } },
      ],
    });
    expect(res.status).toBe(400);
    const stay = await stations().send({
      stations: [{ title: "Y", lat: 58.9, lon: 5.7, night: { kind: "stay" } }],
    });
    expect(stay.status).toBe(400);
  });

  it("keeps the legs of stations that survive a reorder", async () => {
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    // Re-establish the three-station state after the previous test.
    const seeded = await stations().send({
      stations: [
        { title: "Hamburg", lat: 53.55, lon: 9.99, night: { kind: "pass" } },
        {
          title: "Stavanger",
          lat: 58.97,
          lon: 5.73,
          startDate: "2026-07-14",
          endDate: "2026-07-16",
          night: { kind: "stay", lodgingStayId: campStayId },
        },
      ],
    });
    expect(detail.status).toBe(200);
    expect(seeded.status).toBe(200);
    const [a, b] = seeded.body.stations;
    const reordered = await stations().send({
      stations: [
        { id: a.id, title: a.title, lat: a.lat, lon: a.lon, night: { kind: "pass" } },
        { title: "Kristiansand", lat: 58.15, lon: 8.0, night: { kind: "free" } },
        {
          id: b.id,
          title: b.title,
          lat: b.lat,
          lon: b.lon,
          night: { kind: "stay", lodgingStayId: campStayId },
        },
      ],
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.stations.map((s: { id: string }) => s.id)).toEqual([
      a.id,
      expect.any(String),
      b.id,
    ]);
    expect(reordered.body.legs).toHaveLength(2);
  });

  it("reads a station whose stay was deleted as a free night", async () => {
    const extraStay = await makeStay(userId, "Kurz", "2026-07-20", "2026-07-21");
    const res = await stations().send({
      stations: [
        { title: "Kurz", lat: 59, lon: 6, night: { kind: "stay", lodgingStayId: extraStay } },
      ],
    });
    expect(res.body.stations[0].state).toBe("stay");
    await prisma.lodgingStay.delete({ where: { id: extraStay } });
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.stations[0]).toMatchObject({ state: "free", lodgingStayId: null });
    expect(detail.body.nights.freeNights).toBe(1);
  });

  it("anchors a day tour at a station and lists it on the roadtrip", async () => {
    const seeded = await stations().send({
      stations: [
        {
          title: "Stavanger",
          lat: 58.97,
          lon: 5.73,
          night: { kind: "stay", lodgingStayId: campStayId },
        },
      ],
    });
    const stationId = seeded.body.stations[0].id as string;
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Preikestolen", mode: "foot", activity: "hike" });
    expect(tour.body.route).toMatchObject({ kind: "tour", activity: "hike" });

    const anchored = await request(app)
      .patch(`/api/v1/tours/${tour.body.route.id}`)
      .set("Cookie", cookie)
      .send({ anchorStopId: stationId });
    expect(anchored.status).toBe(200);
    expect(anchored.body.route.anchorStopId).toBe(stationId);

    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.tours).toEqual([
      expect.objectContaining({ name: "Preikestolen", activity: "hike", anchorStopId: stationId }),
    ]);
    const list = await request(app).get("/api/v1/roadtrips").set("Cookie", cookie);
    expect(list.body.roadtrips[0]).toMatchObject({ id: roadtripId, tourCount: 1 });
  });

  it("refuses an anchor on a roadtrip and a stranger's station as anchor", async () => {
    const seeded = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    const stationId = seeded.body.stations[0].id as string;
    const onRoadtrip = await request(app)
      .patch(`/api/v1/tours/${roadtripId}`)
      .set("Cookie", cookie)
      .send({ anchorStopId: stationId });
    expect(onRoadtrip.status).toBe(400);

    const strangersTour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", strangerCookie)
      .send({ name: "Fremd", mode: "foot" });
    const res = await request(app)
      .patch(`/api/v1/tours/${strangersTour.body.route.id}`)
      .set("Cookie", strangerCookie)
      .send({ anchorStopId: stationId });
    expect(res.status).toBe(404);
  });

  it("moves only a roadtrip between trips", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Sommer im Norden" } });
    const moved = await request(app)
      .patch(`/api/v1/tours/${roadtripId}`)
      .set("Cookie", cookie)
      .send({ tripId: trip.id });
    expect(moved.status).toBe(200);
    expect(moved.body.route.tripId).toBe(trip.id);

    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Runde", mode: "foot" });
    const refused = await request(app)
      .patch(`/api/v1/tours/${tour.body.route.id}`)
      .set("Cookie", cookie)
      .send({ tripId: trip.id });
    expect(refused.status).toBe(400);
  });

  it("switches a row's kind and clears the automatic flag; confirm clears it too", async () => {
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Radreise Elbe", mode: "bike" });
    const id = tour.body.route.id as string;
    await prisma.tripRoute.update({ where: { id }, data: { kindAssignedAutomatically: true } });

    const switched = await request(app)
      .patch(`/api/v1/tours/${id}/kind`)
      .set("Cookie", cookie)
      .send({ kind: "roadtrip", vehicle: "bicycle" });
    expect(switched.body.route).toMatchObject({
      kind: "roadtrip",
      vehicle: "bicycle",
      kindAssignedAutomatically: false,
    });

    await prisma.tripRoute.update({ where: { id }, data: { kindAssignedAutomatically: true } });
    const confirmed = await request(app)
      .post(`/api/v1/tours/${id}/kind/confirm`)
      .set("Cookie", cookie);
    expect(confirmed.body.route).toMatchObject({
      kind: "roadtrip",
      kindAssignedAutomatically: false,
    });
  });

  it("does not show a roadtrip to anyone else, and 404s a tour id on the roadtrip path", async () => {
    const other = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}`)
      .set("Cookie", strangerCookie);
    expect(other.status).toBe(404);
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Nur eine Tour", mode: "foot" });
    const asRoadtrip = await request(app)
      .get(`/api/v1/roadtrips/${tour.body.route.id}`)
      .set("Cookie", cookie);
    expect(asRoadtrip.status).toBe(404);
  });
});

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

  it("counts no night at a station whose linked stay was cancelled", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Storniert Camping", type: "campsite", lat: 60.1, lon: 6.6 },
    });
    const cancelled = await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn: d("2026-07-18"),
        checkOut: d("2026-07-20"),
        status: "cancelled",
      },
    });
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Abgesagt", vehicle: "campervan" });
    const res = await stations(created.body.roadtrip.id).send({
      stations: [
        {
          title: "Odda",
          lat: 60.07,
          lon: 6.55,
          startDate: "2026-07-18",
          endDate: "2026-07-20",
          night: { kind: "stay", lodgingStayId: cancelled.id },
        },
      ],
    });
    expect(res.status).toBe(200);
    // The link stays — the station still names the stay — but the night is
    // the stay's, and a cancelled stay has none (as in the lodging statistics).
    expect(res.body.stations[0].state).toBe("stay");
    expect(res.body.nights).toMatchObject({ stayNights: 0, nights: 0, placesSlept: 0 });
  });

  it("gives a trip stop back without its night when its roadtrip is deleted", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Norwegen im Bus", mode: "road", kind: "roadtrip" },
    });
    const stop = await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Stavanger",
        lat: 58.97,
        lon: 5.73,
        routeId: route.id,
        routeOrderIdx: 0,
        lodgingStayId: campStayId,
        overnight: true,
      },
    });

    const res = await request(app).delete(`/api/v1/tours/${route.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    // The timeline keeps its stop; the night columns were the roadtrip's
    // station state, and a stop outside a roadtrip is no station.
    const back = await prisma.tripStop.findUniqueOrThrow({ where: { id: stop.id } });
    expect(back).toMatchObject({
      tripId: trip.id,
      routeId: null,
      routeOrderIdx: null,
      lodgingStayId: null,
      overnight: false,
    });
  });

  it("lists each roadtrip with its station points, in order, for the list's route sketch", async () => {
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Skizze" });
    const id = created.body.roadtrip.id as string;
    await stations(id).send({
      stations: [
        { title: "A", lat: 53.55, lon: 10.0, night: { kind: "pass" } },
        { title: "B", lat: 57.59, lon: 9.96, night: { kind: "free" } },
      ],
    });
    const list = await request(app).get("/api/v1/roadtrips").set("Cookie", cookie);
    const row = list.body.roadtrips.find((r: { id: string }) => r.id === id);
    expect(row.points).toEqual([
      [10.0, 53.55],
      [9.96, 57.59],
    ]);
  });

  it("reports a day tour's climb and moving time only when every recording carries them", async () => {
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Zwei Uhren" });
    const id = created.body.roadtrip.id as string;
    const seeded = await stations(id).send({
      stations: [{ title: "Odda", lat: 60.07, lon: 6.55, night: { kind: "free" } }],
    });
    const stationId = seeded.body.stations[0].id as string;
    const track = (
      routeId: string,
      source: string,
      ascentM: number | null,
      movingSeconds: number | null
    ) =>
      prisma.tripRouteTrack.create({
        data: {
          routeId,
          source,
          startedAt: d("2026-07-16"),
          endedAt: d("2026-07-16"),
          geometry: [
            [6.55, 60.07],
            [6.6, 60.1],
          ],
          pointCount: 2,
          distanceKm: 4,
          ascentM,
          movingSeconds,
        },
      });
    const mk = async (name: string) => {
      const tour = await request(app)
        .post("/api/v1/tours")
        .set("Cookie", cookie)
        .send({ name, mode: "foot", activity: "hike" });
      await request(app)
        .patch(`/api/v1/tours/${tour.body.route.id}`)
        .set("Cookie", cookie)
        .send({ anchorStopId: stationId });
      return tour.body.route.id as string;
    };
    const whole = await mk("Ganz");
    await track(whole, "fit", 300, 3600);
    await track(whole, "gpx", 212, 1800);
    const partial = await mk("Halb");
    await track(partial, "gpx", 500, 7200);
    await track(partial, "gpx", null, null);

    const detail = await request(app).get(`/api/v1/roadtrips/${id}`).set("Cookie", cookie);
    const byName = Object.fromEntries(detail.body.tours.map((t: { name: string }) => [t.name, t]));
    expect(byName.Ganz).toMatchObject({ ascentM: 512, movingSeconds: 5400, source: "fit" });
    // 500 m is what one watch measured, not what the day climbed.
    expect(byName.Halb).toMatchObject({ ascentM: null, movingSeconds: null, source: "gpx" });
  });

  it("keeps a roadtrip, with all its stations, when the trip it was part of is deleted", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Wird gelöscht" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Bleibt", mode: "road", kind: "roadtrip" },
    });
    // One station borrowed from the trip's timeline, one the roadtrip owns.
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Zeitleiste",
        lat: 58,
        lon: 6,
        routeId: route.id,
        routeOrderIdx: 0,
      },
    });
    await prisma.tripStop.create({
      data: {
        title: "Eigene",
        lat: 59,
        lon: 6,
        routeId: route.id,
        routeOrderIdx: 1,
        domain: "roadtrip",
      },
    });

    const res = await request(app).delete(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    // A roadtrip is a domain of its own, like a flight or a cruise: the trip
    // was a folder around it, not its owner.
    const kept = await prisma.tripRoute.findUnique({
      where: { id: route.id },
      include: { stops: { orderBy: { routeOrderIdx: "asc" } } },
    });
    expect(kept).toMatchObject({ tripId: null, kind: "roadtrip" });
    expect(kept?.stops.map((s) => [s.title, s.tripId])).toEqual([
      ["Zeitleiste", null],
      ["Eigene", null],
    ]);
  });

  it("still deletes a trip's day tours with the trip — they were drawn over its timeline", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Mit Tour" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Wanderung", mode: "foot", kind: "tour" },
    });
    await request(app).delete(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(await prisma.tripRoute.findUnique({ where: { id: tour.id } })).toBeNull();
  });

  it("unlocks the first-roadtrip badge on its own once a started roadtrip has a station", async () => {
    const first = await prisma.achievement.findUniqueOrThrow({ where: { code: "ROADTRIP_FIRST" } });
    await prisma.userAchievement.deleteMany({ where: { userId, achievementId: first.id } });
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Erster" });
    await stations(created.body.roadtrip.id).send({
      stations: [
        { title: "Gestern", lat: 58.9, lon: 5.7, startDate: "2020-05-01", night: { kind: "pass" } },
      ],
    });

    // The check runs after the answer, so the badge arrives a moment later.
    let unlocked = false;
    for (let i = 0; i < 40 && !unlocked; i++) {
      const row = await prisma.userAchievement.findFirst({
        where: { userId, achievementId: first.id, unlockedAt: { not: null } },
      });
      unlocked = row !== null;
      if (!unlocked) await new Promise((r) => setTimeout(r, 100));
    }
    expect(unlocked).toBe(true);
  });

  // Rail left the vehicles on 2026-09-25 (owner): train journeys are a domain
  // of their own. A new or changed roadtrip may not say `rail`; one stored
  // before keeps loading with its value, and an unrelated edit leaves it be.
  it("refuses rail for a new roadtrip, and keeps a stored one by rail as it is", async () => {
    const refused = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Interrail", vehicle: "rail" });
    expect(refused.status).toBe(400);

    const legacy = await prisma.tripRoute.create({
      data: { userId, name: "Interrail 2025", mode: "rail", kind: "roadtrip", vehicle: "rail" },
    });
    const read = await request(app).get(`/api/v1/roadtrips/${legacy.id}`).set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(read.body.roadtrip.vehicle).toBe("rail");

    const renamed = await request(app)
      .patch(`/api/v1/tours/${legacy.id}`)
      .set("Cookie", cookie)
      .send({ name: "Interrail Sommer 2025" });
    expect(renamed.status).toBe(200);
    const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(stored).toMatchObject({ name: "Interrail Sommer 2025", vehicle: "rail" });

    const switched = await request(app)
      .patch(`/api/v1/tours/${legacy.id}`)
      .set("Cookie", cookie)
      .send({ vehicle: "rail" });
    expect(switched.status).toBe(400);
  });

  it("gives a trip the countries its roadtrip's stations stand in", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Nur Roadtrip" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Binnenland", mode: "road", kind: "roadtrip" },
    });
    await prisma.tripStop.create({
      data: {
        title: "Lillehammer",
        lat: 61.11,
        lon: 10.46,
        routeId: route.id,
        routeOrderIdx: 0,
        domain: "roadtrip",
      },
    });

    const detail = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(detail.body.trip.countries).toContain("NO");
    const list = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    const row = list.body.trips.find((t: { id: string }) => t.id === trip.id);
    expect(row.countries).toContain("NO");
  });
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Route corrections (tester 2026-09-26, "Streckenkorrektur"): a nameless point
 * the route bends through. It is a vertex of the legs, so distance and routing
 * honour it, but it is not a station: the list does not count it, its country
 * is not a country visited, and the phone never sees it as a station.
 */
const USER = "viapointer";

describe("Roadtrip route corrections", () => {
  let cookie: string;
  let roadtripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    const res = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Über Dänemark nach Norwegen" });
    roadtripId = res.body.roadtrip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  const put = (stations: unknown[]) =>
    request(app)
      .put(`/api/v1/roadtrips/${roadtripId}/stations`)
      .set("Cookie", cookie)
      .send({ stations });

  // Hamburg (DE) → a correction in Jutland (DK) → Kristiansand (NO).
  const HAMBURG = {
    title: "Hamburg",
    lat: 53.55,
    lon: 9.99,
    startDate: "2026-07-12",
    night: { kind: "pass" },
  };
  const VIA = { title: "", lat: 56.16, lon: 9.55, night: { kind: "via" } };
  const KRISTIANSAND = {
    title: "Kristiansand",
    lat: 58.15,
    lon: 8.0,
    startDate: "2026-07-13",
    endDate: "2026-07-14",
    night: { kind: "free" },
  };

  it("stores a nameless via point and runs the legs through it", async () => {
    const res = await put([HAMBURG, VIA, KRISTIANSAND]);
    expect(res.status).toBe(200);
    expect(res.body.stations.map((s: { state: string }) => s.state)).toEqual([
      "pass",
      "via",
      "free",
    ]);
    expect(res.body.stations[1].title).toBe("");
    // Two legs: the route bends through the correction.
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.nights).toMatchObject({ nights: 1, placesSlept: 1 });
  });

  it("does not count it as a station, nor its country as one visited", async () => {
    const res = await request(app).get("/api/v1/roadtrips").set("Cookie", cookie);
    const summary = res.body.roadtrips.find((r: { id: string }) => r.id === roadtripId);
    expect(summary.stationCount).toBe(2);
    expect(summary.points).toHaveLength(2);
    expect(summary.countries).toEqual(["DE", "NO"]);
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.countries).toEqual(["DE", "NO"]);
  });

  it("gives the phone the stations only, with the legs folded through the correction", async () => {
    const res = await request(app)
      .get("/api/v1/roadtrips/active?date=2026-07-13")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.stations.map((s: { title: string }) => s.title)).toEqual([
      "Hamburg",
      "Kristiansand",
    ]);
  });

  it("refuses a via point that claims a night or a date", async () => {
    const withNightDate = await put([HAMBURG, { ...VIA, startDate: "2026-07-12" }, KRISTIANSAND]);
    expect(withNightDate.status).toBe(400);
    const namelessStation = await put([HAMBURG, { ...KRISTIANSAND, title: "" }]);
    expect(namelessStation.status).toBe(400);
  });

  it("takes a correction from the point editor of a tour, and leaves it out of the count", async () => {
    const created = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Besseggen", mode: "foot" });
    expect(created.status).toBe(201);
    const tourId = created.body.id ?? created.body.route?.id;
    const res = await request(app)
      .put(`/api/v1/tours/${tourId}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "Gjendesheim", lat: 61.4948, lon: 8.8054 },
          { title: "", lat: 61.498, lon: 8.77, via: true },
          { title: "Memurubu", lat: 61.5024, lon: 8.7311 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.stops.map((p: { viaPoint: boolean }) => p.viaPoint)).toEqual([
      false,
      true,
      false,
    ]);
    expect(res.body.legs).toHaveLength(2);
    const list = await request(app).get("/api/v1/tours?kind=tour").set("Cookie", cookie);
    const tour = list.body.tours.find((t: { id: string }) => t.id === tourId);
    expect(tour.stopCount).toBe(2);
  });

  it("refuses to turn a station with a night into a correction through the point editor", async () => {
    const saved = await put([HAMBURG, KRISTIANSAND]);
    const [hamburg, kristiansand] = saved.body.stations;
    const res = await request(app)
      .put(`/api/v1/tours/${roadtripId}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { id: hamburg.id, title: "Hamburg", lat: 53.55, lon: 9.99 },
          { id: kristiansand.id, title: "Kristiansand", lat: 58.15, lon: 8.0, via: true },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VIA_POINT_HAS_NIGHT");
  });
});

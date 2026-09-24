jest.mock("../../services/geo/nominatim", () => {
  const actual = jest.requireActual("../../services/geo/nominatim");
  return { ...actual, reverseGeocode: jest.fn() };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { reverseGeocode } from "../../services/geo/nominatim";
import { seedRoadtripDemo } from "../../seedDemo/seedRoadtrips";

const mockReverse = reverseGeocode as jest.Mock;

/**
 * The phone's roadtrip endpoints (companion#12, #13; 2026-09-24), against the
 * roadtrip demo: Norway 13.–20.07.2025 with a ferry and two campsites, the Alps
 * 02.–07.08.2025, and a trip "Sommer in Norwegen" 15.–19.07.2025.
 */
describe("roadtrips from the phone", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let norwayId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["rtphone1", "rtphone2"] } } });
    const u = await prisma.user.create({
      data: { username: "rtphone1", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "rtphone2", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
    await seedRoadtripDemo(userId);
    norwayId = (
      await prisma.tripRoute.findFirstOrThrow({
        where: { userId, name: "Demo: Norwegen mit dem Wohnmobil" },
      })
    ).id;
  });

  beforeEach(() => mockReverse.mockReset());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["rtphone1", "rtphone2"] } } });
    await prisma.$disconnect();
  });

  const active = (date: string, c = cookie) =>
    request(app).get(`/api/v1/roadtrips/active?date=${date}`).set("Cookie", c);

  describe("GET /roadtrips/active", () => {
    it("finds the roadtrip running that day, and the station the day ends at", async () => {
      const res = await active("2025-07-16");
      expect(res.status).toBe(200);
      expect(res.body.roadtrip.name).toBe("Demo: Norwegen mit dem Wohnmobil");
      const today = res.body.stations.find((s: { id: string }) => s.id === res.body.todayStationId);
      expect(today.title).toBe("Stavanger");
    });

    it("keeps a roadtrip running a few days past its plan, and lets it go after", async () => {
      expect((await active("2025-07-22")).body.roadtrip?.name).toBe(
        "Demo: Norwegen mit dem Wohnmobil"
      );
      expect((await active("2025-07-30")).body.roadtrip).toBeNull();
    });

    it("answers the Alps in August, and nothing for another account", async () => {
      expect((await active("2025-08-04")).body.roadtrip.name).toBe("Demo: Alpen mit dem Campervan");
      expect((await active("2025-08-04", otherCookie)).body.roadtrip).toBeNull();
    });

    it("refuses a date that is not YYYY-MM-DD", async () => {
      expect((await active("16.07.2025")).status).toBe(400);
    });
  });

  describe("POST /roadtrips/:id/stations (append)", () => {
    const append = (body: Record<string, unknown>, c = cookie) =>
      request(app).post(`/api/v1/roadtrips/${norwayId}/stations`).set("Cookie", c).send(body);

    it("appends a free night where the phone stands, named by the reverse geocoder", async () => {
      mockReverse.mockResolvedValue({
        address: "Hellesylt 6218",
        city: "Hellesylt",
        country: "Norway",
      });
      const res = await append({ lat: 62.0833, lon: 6.8667, date: "2025-07-21", night: "free" });
      expect(res.status).toBe(201);
      expect(res.body.station).toMatchObject({ title: "Hellesylt" });
      const last = res.body.stations[res.body.stations.length - 1];
      expect(last.id).toBe(res.body.station.id);
      // The leg from the old last station to the new one exists.
      expect(res.body.legs.some((l: { toStopId: string }) => l.toStopId === last.id)).toBe(true);
    });

    it("answers a resend with the station it already made, and adds nothing", async () => {
      mockReverse.mockResolvedValue({ city: "Hellesylt" });
      const before = await prisma.tripStop.count({ where: { routeId: norwayId } });
      const again = await append({ lat: 62.0835, lon: 6.8669, date: "2025-07-21", night: "free" });
      expect(again.status).toBe(200);
      expect(await prisma.tripStop.count({ where: { routeId: norwayId } })).toBe(before);
    });

    it("keeps the phone's own title and falls back to a number without a geocoder answer", async () => {
      mockReverse.mockResolvedValue(null);
      const named = await append({
        lat: 62.47,
        lon: 6.15,
        date: "2025-07-22",
        night: "pass",
        title: "Tankstelle Ålesund",
      });
      expect(named.body.station.title).toBe("Tankstelle Ålesund");
      const unnamed = await append({ lat: 62.2, lon: 6.5, date: "2025-07-23", night: "pass" });
      expect(unnamed.body.station.title).toMatch(/^Station \d+$/);
    });

    it("refuses a stay, which only the web links, and another account's roadtrip", async () => {
      expect((await append({ lat: 62, lon: 6, date: "2025-07-24", night: "stay" })).status).toBe(
        400
      );
      expect(
        (await append({ lat: 62, lon: 6, date: "2025-07-24", night: "free" }, otherCookie)).status
      ).toBe(404);
    });
  });

  describe("GET /day-context", () => {
    it("names the trip and the roadtrip station of a day", async () => {
      const res = await request(app)
        .get("/api/v1/day-context?date=2025-07-16")
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.trip.name).toBe("Demo: Sommer in Norwegen");
      expect(res.body.station).toMatchObject({
        title: "Stavanger",
        roadtripId: norwayId,
        roadtripName: "Demo: Norwegen mit dem Wohnmobil",
      });
    });

    it("answers null for a day that belongs to nothing", async () => {
      const res = await request(app)
        .get("/api/v1/day-context?date=2025-10-01")
        .set("Cookie", cookie);
      expect(res.body).toEqual({ trip: null, station: null });
    });
  });

  describe("POST /tours with an anchor", () => {
    it("sets a day tour out from the caller's station, and refuses a stranger's", async () => {
      const stavanger = await prisma.tripStop.findFirstOrThrow({
        where: { routeId: norwayId, title: "Stavanger" },
      });
      const ok = await request(app)
        .post("/api/v1/tours")
        .set("Cookie", cookie)
        .send({ name: "Watch hike", mode: "foot", activity: "hike", anchorStopId: stavanger.id });
      expect(ok.status).toBe(201);
      expect(ok.body.route.anchorStopId).toBe(stavanger.id);

      const foreign = await request(app)
        .post("/api/v1/tours")
        .set("Cookie", otherCookie)
        .send({ name: "x", mode: "foot", anchorStopId: stavanger.id });
      expect(foreign.status).toBe(404);
    });
  });
});

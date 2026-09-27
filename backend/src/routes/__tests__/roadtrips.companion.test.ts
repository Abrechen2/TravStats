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
      // ADR 0002 dual-write: the night's day starts at the station's midnight.
      const row = await prisma.tripStop.findUniqueOrThrow({ where: { id: last.id } });
      expect(row.stopZone).toBe("Europe/Oslo");
      expect(row.startUtc?.toISOString()).toBe("2025-07-20T22:00:00.000Z");
      expect(row.precision).toBe("day");
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

    it("refuses a stay without its stay id, and another account's roadtrip", async () => {
      expect((await append({ lat: 62, lon: 6, date: "2025-07-24", night: "stay" })).status).toBe(
        400
      );
      expect(
        (await append({ lat: 62, lon: 6, date: "2025-07-24", night: "free" }, otherCookie)).status
      ).toBe(404);
    });
  });

  /** A stay of `owner` at Geiranger, 25.–27.07.2025 (forgejo#132 item 2). */
  async function geirangerStay(owner: string): Promise<string> {
    const lodging = await prisma.lodging.create({
      data: {
        userId: owner,
        type: "campsite",
        name: "Geiranger Camping",
        lat: 62.1,
        lon: 7.2,
        city: "Geiranger",
        country: "Norway",
        isoCountryCode: "NO",
        visited: true,
      },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId: owner,
        lodgingId: lodging.id,
        checkIn: new Date("2025-07-25T00:00:00Z"),
        checkOut: new Date("2025-07-27T00:00:00Z"),
        datePrecision: "DAY",
        nights: 2,
        status: "completed",
      },
    });
    return stay.id;
  }

  describe("POST /roadtrips/:id/stations with a stay (forgejo#132 item 2)", () => {
    const append = (body: Record<string, unknown>, c = cookie) =>
      request(app).post(`/api/v1/roadtrips/${norwayId}/stations`).set("Cookie", c).send(body);

    it("appends a stay station linked to the caller's stay, named and dated by it", async () => {
      mockReverse.mockResolvedValue({ city: "Somewhere else" });
      const stayId = await geirangerStay(userId);
      const res = await append({
        lat: 62.101,
        lon: 7.201,
        date: "2025-07-25",
        night: "stay",
        lodgingStayId: stayId,
      });
      expect(res.status).toBe(201);
      expect(res.body.station).toMatchObject({
        title: "Geiranger Camping",
        state: "stay",
        lodgingStayId: stayId,
      });
      expect(res.body.station.endDate.slice(0, 10)).toBe("2025-07-27");
      // The reverse geocoder is not asked when the stay names the place.
      expect(mockReverse).not.toHaveBeenCalled();
    });

    it("refuses another account's stay, and a stay id on a night that is not a stay", async () => {
      const otherId = (await prisma.user.findUniqueOrThrow({ where: { username: "rtphone2" } })).id;
      const foreign = await geirangerStay(otherId);
      const before = await prisma.tripStop.count({ where: { routeId: norwayId } });
      const res = await append({
        lat: 62.3,
        lon: 7.3,
        date: "2025-07-26",
        night: "stay",
        lodgingStayId: foreign,
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Stay not found");
      expect(await prisma.tripStop.count({ where: { routeId: norwayId } })).toBe(before);

      const mixed = await append({
        lat: 62.3,
        lon: 7.3,
        date: "2025-07-26",
        night: "free",
        lodgingStayId: foreign,
      });
      expect(mixed.status).toBe(400);
    });
  });

  describe("DELETE /roadtrips/:id/stations/:stationId (forgejo#132 item 1)", () => {
    const remove = (stationId: string, c = cookie, routeId = norwayId) =>
      request(app).delete(`/api/v1/roadtrips/${routeId}/stations/${stationId}`).set("Cookie", c);

    it("removes the station the phone just appended, and leaves no leg to it", async () => {
      mockReverse.mockResolvedValue(null);
      const added = await request(app)
        .post(`/api/v1/roadtrips/${norwayId}/stations`)
        .set("Cookie", cookie)
        .send({ lat: 61.9, lon: 6.7, date: "2025-07-28", night: "free", title: "Undo me" });
      expect(added.status).toBe(201);
      const id = added.body.station.id;
      const before = added.body.stations.length;

      const res = await remove(id);
      expect(res.status).toBe(200);
      expect(res.body.removed).toEqual({ id, released: false });
      expect(res.body.stations).toHaveLength(before - 1);
      expect(res.body.stations.some((s: { id: string }) => s.id === id)).toBe(false);
      expect(res.body.stations.map((s: { order: number }) => s.order)).toEqual([
        ...Array(before - 1).keys(),
      ]);
      expect(
        res.body.legs.some(
          (l: { fromStopId: string; toStopId: string }) => l.fromStopId === id || l.toStopId === id
        )
      ).toBe(false);
      expect(await prisma.tripStop.findUnique({ where: { id } })).toBeNull();
    });

    it("renumbers and re-links when a station in the middle goes", async () => {
      const stations = await prisma.tripStop.findMany({
        where: { routeId: norwayId },
        orderBy: { routeOrderIdx: "asc" },
      });
      const middle = stations.find(
        (s, i) => s.tripId === null && i > 0 && i < stations.length - 1
      )!;
      const at = stations.indexOf(middle);
      const prev = stations[at - 1];
      const next = stations[at + 1];

      const res = await remove(middle.id);
      expect(res.status).toBe(200);
      expect(res.body.stations.map((s: { order: number }) => s.order)).toEqual([
        ...Array(stations.length - 1).keys(),
      ]);
      expect(
        res.body.legs.some(
          (l: { fromStopId: string; toStopId: string }) =>
            l.fromStopId === prev.id && l.toStopId === next.id
        )
      ).toBe(true);
    });

    it("releases a trip's timeline stop back to the trip instead of deleting it", async () => {
      const trip = await prisma.trip.findFirstOrThrow({ where: { userId } });
      const last = await prisma.tripStop.aggregate({
        where: { routeId: norwayId },
        _max: { routeOrderIdx: true },
      });
      const stop = await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          title: "Timeline stop",
          lat: 61.5,
          lon: 6.5,
          routeId: norwayId,
          routeOrderIdx: (last._max.routeOrderIdx ?? -1) + 1,
          overnight: true,
        },
      });
      const res = await remove(stop.id);
      expect(res.status).toBe(200);
      expect(res.body.removed).toEqual({ id: stop.id, released: true });
      const kept = await prisma.tripStop.findUniqueOrThrow({ where: { id: stop.id } });
      expect(kept).toMatchObject({ tripId: trip.id, routeId: null, routeOrderIdx: null });
    });

    it("answers 404 for another account, another roadtrip's station and an unknown id", async () => {
      const station = await prisma.tripStop.findFirstOrThrow({ where: { routeId: norwayId } });
      expect((await remove(station.id, otherCookie)).status).toBe(404);

      const alps = await prisma.tripRoute.findFirstOrThrow({
        where: { userId, name: "Demo: Alpen mit dem Campervan" },
      });
      const wrongRoute = await remove(station.id, cookie, alps.id);
      expect(wrongRoute.status).toBe(404);
      expect(wrongRoute.body.error).toBe("Station not found");
      expect(await prisma.tripStop.findUnique({ where: { id: station.id } })).not.toBeNull();

      expect((await remove("00000000-0000-4000-8000-000000000000")).status).toBe(404);
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

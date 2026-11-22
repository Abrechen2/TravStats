import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** Private or business (spec 2026-11-22-private-business-purpose). */
describe("purpose: private or business", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  let userId: string;
  let cookie: string;
  let otherCookie: string;

  const mk = async (name: string): Promise<string> => {
    const user = await prisma.user.create({
      data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    ids.push(user.id);
    return user.id;
  };
  const hide = (visibility: unknown) =>
    request(app).put("/api/v1/purpose/visibility").set("Cookie", cookie).send(visibility);

  const flight = (extra: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "FCO",
        depLat: 50,
        depLon: 8,
        arrLat: 41,
        arrLon: 12,
        status: "flown",
        departureTime: new Date("2025-03-01T08:00:00Z"),
        arrivalTime: new Date("2025-03-01T10:00:00Z"),
        ...extra,
      },
    });

  beforeAll(async () => {
    userId = await mk("purpose");
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(await mk("purpose-other"))}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  describe("taken over from the trip on creation", () => {
    const inTrip = async (category: string | null) => {
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: `T-${category}`,
          category,
          startDate: new Date("2025-03-01T00:00:00Z"),
          endDate: new Date("2025-03-05T00:00:00Z"),
        },
      });
      return (await flight({ tripId: trip.id })).purpose;
    };

    it("a flight created in a business trip starts as business", async () => {
      expect(await inTrip("business")).toBe("business");
    });
    it.each(["vacation", "weekend", "family"])("a %s trip gives private", async (category) => {
      expect(await inTrip(category)).toBe("private");
    });
    it("other and no category give unknown, never private", async () => {
      expect(await inTrip("other")).toBeNull();
      expect(await inTrip(null)).toBeNull();
    });
    it("an explicit purpose beats the trip, and the trip is no live link", async () => {
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: "B",
          category: "business",
          startDate: new Date("2025-03-01T00:00:00Z"),
          endDate: new Date("2025-03-05T00:00:00Z"),
        },
      });
      const f = await flight({ tripId: trip.id, purpose: "private" });
      expect(f.purpose).toBe("private");
      await prisma.trip.update({ where: { id: trip.id }, data: { category: "vacation" } });
      const g = await flight({ tripId: trip.id });
      expect(g.purpose).toBe("private");
      const kept = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
      expect(kept.purpose).toBe("private");
    });
    it("a visit created through the API inside a business trip starts as business", async () => {
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: "Visit trip",
          category: "business",
          startDate: new Date("2025-04-01T00:00:00Z"),
          endDate: new Date("2025-04-05T00:00:00Z"),
        },
      });
      const place = await prisma.place.create({
        data: { userId, name: "Anlage Nord", lat: 52.1, lon: 9.1 },
      });
      const res = await request(app)
        .post(`/api/v1/places/${place.id}/visits`)
        .set("Cookie", cookie)
        .send({ tripId: trip.id, visitedAt: "2025-04-02" });
      expect(res.status).toBe(201);
      expect(res.body.data.purpose).toBe("business");
    });
  });

  describe("an older client that omits purpose keeps it", () => {
    it("a flight update without purpose leaves business as it is", async () => {
      const f = await flight({ purpose: "business" });
      const res = await request(app)
        .put(`/api/v1/flights/${f.id}`)
        .set("Cookie", cookie)
        .send({ notes: "gate B7" });
      expect(res.status).toBe(200);
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).purpose).toBe(
        "business"
      );
    });
    it("a visit patch without purpose leaves it; an explicit null clears it", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Halle 3", lat: 52.2, lon: 9.2 },
      });
      const visit = await prisma.placeVisit.create({
        data: { userId, placeId: place.id, purpose: "business", visitedAt: new Date("2025-02-01") },
      });
      const keep = await request(app)
        .patch(`/api/v1/places/visits/${visit.id}`)
        .set("Cookie", cookie)
        .send({ notes: "x" });
      expect(keep.status).toBe(200);
      expect(keep.body.data.purpose).toBe("business");
      const cleared = await request(app)
        .patch(`/api/v1/places/visits/${visit.id}`)
        .set("Cookie", cookie)
        .send({ purpose: null });
      expect(cleared.body.data.purpose).toBeNull();
    });
  });

  describe("the entry endpoint", () => {
    it("sets, clears and refuses a stranger's entry", async () => {
      const f = await flight();
      const put = (c: string, purpose: unknown) =>
        request(app)
          .put(`/api/v1/purpose/entries/flight/${f.id}`)
          .set("Cookie", c)
          .send({ purpose });
      expect((await put(cookie, "business")).body.data.purpose).toBe("business");
      expect((await put(cookie, null)).body.data.purpose).toBeNull();
      expect((await put(otherCookie, "business")).status).toBe(404);
      expect((await put(cookie, "work")).status).toBe(400);
    });
  });

  describe("hiding is per domain, on the server, and never hides unknown", () => {
    let flightsOf: () => Promise<string[]>;
    beforeAll(() => {
      flightsOf = async () => {
        const res = await request(app).get("/api/v1/flights?limit=500").set("Cookie", cookie);
        return (res.body.flights as Array<{ id: string }>).map((f) => f.id);
      };
    });

    it("hiding business flights leaves private and unknown ones, and only that domain", async () => {
      const biz = await flight({ purpose: "business" });
      const priv = await flight({ purpose: "private" });
      const unknown = await flight();
      const place = await prisma.place.create({
        data: { userId, name: "Halle 9", lat: 1, lon: 1, visited: true },
      });
      const visit = await prisma.placeVisit.create({
        data: { userId, placeId: place.id, purpose: "business", visitedAt: new Date("2025-02-01") },
      });

      expect((await hide({ flight: ["business"] })).status).toBe(200);
      const hidden = await flightsOf();
      expect(hidden).not.toContain(biz.id);
      expect(hidden).toEqual(expect.arrayContaining([priv.id, unknown.id]));
      // The places domain was not asked to hide anything.
      const places = await request(app).get("/api/v1/places").set("Cookie", cookie);
      expect(JSON.stringify(places.body)).toContain(place.id);

      expect((await hide({ poi: ["business"] })).status).toBe(200);
      expect(await flightsOf()).toContain(biz.id);
      const placesHidden = await request(app).get("/api/v1/places").set("Cookie", cookie);
      // A place visited only on business is not a back door into the visited count.
      expect(JSON.stringify(placesHidden.body)).not.toContain(place.id);
      const visitRes = await request(app)
        .get(`/api/v1/places/visits/${visit.id}`)
        .set("Cookie", cookie);
      expect(visitRes.status).toBe(404);

      await hide({});
      expect(
        JSON.stringify((await request(app).get("/api/v1/places").set("Cookie", cookie)).body)
      ).toContain(place.id);
    });

    it("counts agree with lists, and the hint counts what is hidden", async () => {
      await prisma.flight.deleteMany({ where: { userId } });
      await flight({ purpose: "business" });
      await flight({ purpose: "business" });
      await flight({ purpose: "private" });
      await flight();
      const total = async (): Promise<number> =>
        (await request(app).get("/api/v1/stats/summary").set("Cookie", cookie)).body.totalFlights;
      const before = await total();
      await hide({ flight: ["business"] });
      expect(await total()).toBe(before - 2);
      expect((await flightsOf()).length).toBe(before - 2);
      const hint = await request(app).get("/api/v1/purpose/hidden").set("Cookie", cookie);
      expect(hint.body.data.hidden.flight.business).toBe(2);
      await hide({});
      expect(await total()).toBe(before);
    });

    it("the visibility revision changes with the setting and rides on scoped reads", async () => {
      const a = (await hide({})).body.data.revision as string;
      const b = (await hide({ flight: ["business"] })).body.data.revision as string;
      expect(b).not.toBe(a);
      const read = await request(app).get("/api/v1/flights").set("Cookie", cookie);
      expect(read.headers["x-purpose-visibility"]).toBe(b);
      await hide({});
    });

    it("a request parameter cannot bypass the stored setting", async () => {
      const biz = await flight({ purpose: "business" });
      await hide({ flight: ["business"] });
      const res = await request(app)
        .get("/api/v1/flights?limit=500&purpose=all&includeHidden=true&onlyRecorded=false")
        .set("Cookie", cookie);
      expect(res.body.flights.map((f: { id: string }) => f.id)).not.toContain(biz.id);
      await hide({});
    });
  });

  describe("trip actions", () => {
    const biz = async () =>
      prisma.trip.create({
        data: {
          userId,
          name: "Inbetriebnahme",
          category: "business",
          startDate: new Date("2025-05-01T00:00:00Z"),
          endDate: new Date("2025-05-03T00:00:00Z"),
        },
      });

    it("apply writes the trip's purpose onto every entry, including ones with another", async () => {
      const trip = await biz();
      const a = await flight({ tripId: trip.id, purpose: "private" });
      const b = await flight({ tripId: trip.id, purpose: null });
      const res = await request(app)
        .post(`/api/v1/purpose/trips/${trip.id}/apply`)
        .set("Cookie", cookie)
        .send({});
      expect(res.body.data).toEqual({ purpose: "business", changed: expect.any(Number) });
      for (const f of [a, b]) {
        expect((await prisma.flight.findUniqueOrThrow({ where: { id: f.id } })).purpose).toBe(
          "business"
        );
      }
      const stranger = await request(app)
        .post(`/api/v1/purpose/trips/${trip.id}/apply`)
        .set("Cookie", otherCookie)
        .send({});
      expect(stranger.status).toBe(404);
    });

    it("from-trips fills only entries without a purpose", async () => {
      const trip = await biz();
      const kept = await flight({ tripId: trip.id, purpose: "private" });
      // Created before the field existed: no purpose, in a categorised trip.
      const old = await flight({ tripId: trip.id });
      await prisma.flight.update({ where: { id: old.id }, data: { purpose: null } });
      const res = await request(app).post("/api/v1/purpose/from-trips").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: old.id } })).purpose).toBe(
        "business"
      );
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: kept.id } })).purpose).toBe(
        "private"
      );
    });
  });
});

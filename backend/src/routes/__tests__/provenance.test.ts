import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { FLIGHT_FACT_FIELDS } from "../../services/sharing/facts/flight";
import { TRIP_FACT_FIELDS } from "../../services/sharing/facts/trip";

/**
 * "Aus der Erinnerung" (docs/superpowers/specs/2026-11-22-remembered-facts.md): an entry typed in
 * from memory says so; statistics count it unless asked for "nur belegte"; a recorded date that a
 * remembered span contradicts becomes ONE persisted inbox notice and nothing is overwritten.
 */
describe("remembered facts", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;

  const put = (type: string, id: string, body: object, c = cookie) =>
    request(app).put(`/api/v1/provenance/${type}/${id}`).set("Cookie", c).send(body);
  const notices = (c = cookie) => request(app).get("/api/v1/provenance/notices").set("Cookie", c);
  const flight = (extra: object) =>
    prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "LIS",
        arrLat: 38.77,
        arrLon: -9.13,
        status: "flown",
        ...extra,
      },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rf-a-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `rf-b-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  describe("marking", () => {
    it("stores remembered with the day it was written down and the user's own words", async () => {
      const trip = await prisma.trip.create({ data: { userId, name: "Italien 1998" } });
      const res = await put("trip", trip.id, {
        provenance: "remembered",
        rememberedOn: "2026-11-22",
        rememberedNote: "Sommer 1998, ungefähr zwei Wochen, mit dem Auto",
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        provenance: "remembered",
        rememberedOn: "2026-11-22",
        rememberedNote: "Sommer 1998, ungefähr zwei Wochen, mit dem Auto",
      });
      const row = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
      expect(row.provenance).toBe("remembered");
    });

    it("clearing the mark clears the date and the note with it", async () => {
      const f = await flight({ departureTime: new Date("2001-07-01T08:00:00Z") });
      await put("flight", f.id, { provenance: "remembered", rememberedNote: "irgendwann im Juli" });
      const res = await put("flight", f.id, { provenance: null });
      expect(res.body.data).toEqual({ provenance: null, rememberedOn: null, rememberedNote: null });
    });

    it("refuses a note on an entry that is not remembered", async () => {
      const f = await flight({ departureTime: new Date("2001-07-01T08:00:00Z") });
      const res = await put("flight", f.id, { provenance: "recorded", rememberedNote: "x" });
      expect(res.status).toBe(400);
    });

    it("refuses a day that is not on the calendar instead of rolling it into March", async () => {
      const f = await flight({});
      const res = await put("flight", f.id, {
        provenance: "remembered",
        rememberedOn: "2026-02-30",
      });
      expect(res.status).toBe(400);
    });

    it("keeps the database from holding a note on an entry that is not remembered", async () => {
      const f = await flight({});
      await expect(
        prisma.flight.update({ where: { id: f.id }, data: { rememberedNote: "orphan" } })
      ).rejects.toThrow();
    });

    it("marks every kind of entry and refuses a stranger's entry", async () => {
      const lodging = await prisma.lodging.create({
        data: { userId, name: "Pension Rosa", city: "Rimini", lat: 44.06, lon: 12.57 },
      });
      const stay = await prisma.lodgingStay.create({ data: { userId, lodgingId: lodging.id } });
      const f = await flight({});
      for (const [type, id] of [
        ["lodgingStay", stay.id],
        ["flight", f.id],
      ] as const) {
        expect((await put(type, id, { provenance: "recorded" })).status).toBe(200);
      }
      expect((await put("flight", f.id, { provenance: "remembered" }, strangerCookie)).status).toBe(
        404
      );
    });

    it("keeps provenance private: a share copy never carries it", () => {
      expect(FLIGHT_FACT_FIELDS as readonly string[]).not.toContain("provenance");
      expect(TRIP_FACT_FIELDS as readonly string[]).not.toContain("provenance");
      expect(TRIP_FACT_FIELDS as readonly string[]).not.toContain("rememberedNote");
    });
  });

  describe("statistics", () => {
    it("count a remembered flight by default and leave it out under onlyRecorded, keeping unknown ones", async () => {
      const u = (
        await prisma.user.create({
          data: { username: `rf-s-${stamp}`, passwordHash: await hashPassword("test-password") },
        })
      ).id;
      try {
        const make = (provenance: string | null) =>
          prisma.flight.create({
            data: {
              userId: u,
              depIata: "FRA",
              depLat: 50.03,
              depLon: 8.56,
              arrIata: "MUC",
              arrLat: 48.35,
              arrLon: 11.78,
              status: "flown",
              departureTime: new Date("2005-05-05T08:00:00Z"),
              arrivalTime: new Date("2005-05-05T09:00:00Z"),
              provenance,
            },
          });
        await make("remembered");
        await make("recorded");
        await make(null);
        const c = `auth_token=${generateToken(u)}`;
        const get = (path: string) => request(app).get(`/api/v1${path}`).set("Cookie", c);
        expect((await get("/stats/summary")).body.totalFlights).toBe(3);
        expect((await get("/stats/summary?onlyRecorded=true")).body.totalFlights).toBe(2);
        expect((await get("/stats/summary?onlyRecorded=false")).body.totalFlights).toBe(3);
      } finally {
        await prisma.user.delete({ where: { id: u } });
      }
    });

    it("two endpoints agree under the filter: the summary total and the flight list see the same population", async () => {
      const u = (
        await prisma.user.create({
          data: { username: `rf-g-${stamp}`, passwordHash: await hashPassword("test-password") },
        })
      ).id;
      try {
        for (const provenance of ["remembered", "remembered", "recorded", null]) {
          await prisma.flight.create({
            data: {
              userId: u,
              depIata: "FRA",
              depLat: 50.03,
              depLon: 8.56,
              arrIata: "MUC",
              arrLat: 48.35,
              arrLon: 11.78,
              status: "flown",
              departureTime: new Date("2006-06-06T08:00:00Z"),
              arrivalTime: new Date("2006-06-06T09:00:00Z"),
              provenance,
            },
          });
        }
        const c = `auth_token=${generateToken(u)}`;
        const get = (path: string) => request(app).get(`/api/v1${path}`).set("Cookie", c);
        const rows = (body: unknown): unknown[] =>
          Array.isArray(body) ? body : ((body as { flights: unknown[] }).flights ?? []);
        for (const [query, expected] of [
          ["", 4],
          ["?onlyRecorded=true", 2],
        ] as const) {
          const summary = await get(`/stats/summary${query}`);
          const list = await get(`/flights${query}`);
          expect(list.status).toBe(200);
          expect(summary.body.totalFlights).toBe(expected);
          expect(rows(list.body)).toHaveLength(expected);
        }
        // The parameter never reaches a handler that validates its query strictly.
        expect((await get("/flights?onlyRecorded=true&limit=1")).status).toBe(200);
      } finally {
        await prisma.user.delete({ where: { id: u } });
      }
    });
  });

  describe("contradiction notice", () => {
    let tripId: string;
    let flightId: string;

    beforeAll(async () => {
      // A remembered "Sommer 1998" trip, 1-14 July, and a recorded flight in September.
      tripId = (
        await prisma.trip.create({
          data: {
            userId,
            name: "Sommer 1998",
            provenance: "remembered",
            startDate: new Date("1998-07-01T00:00:00Z"),
            endDate: new Date("1998-07-14T00:00:00Z"),
          },
        })
      ).id;
      flightId = (
        await flight({
          tripId,
          departureTime: new Date("1998-09-02T08:00:00Z"),
          provenance: "recorded",
        })
      ).id;
      // A recorded flight inside the span and one a few hours past its end: neither contradicts it.
      await flight({
        tripId,
        departureTime: new Date("1998-07-05T08:00:00Z"),
        provenance: "recorded",
      });
      await flight({
        tripId,
        departureTime: new Date("1998-07-14T20:00:00Z"),
        provenance: "recorded",
      });
    });

    it("raises ONE persisted notice for a recorded date outside the remembered span, and overwrites nothing", async () => {
      const first = await notices();
      expect(first.status).toBe(200);
      const mine = first.body.data.notices.filter(
        (n: { detail: { remembered: { id: string } } }) => n.detail.remembered.id === tripId
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].kind).toBe("outsideRememberedSpan");
      expect(mine[0].detail.recorded.id).toBe(flightId);

      await notices();
      await notices();
      expect(await prisma.provenanceNotice.count({ where: { userId, entryId: tripId } })).toBe(1);

      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(trip.startDate?.toISOString()).toBe("1998-07-01T00:00:00.000Z");
      expect(trip.endDate?.toISOString()).toBe("1998-07-14T00:00:00.000Z");
      const f = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
      expect(f.departureTime?.toISOString()).toBe("1998-09-02T08:00:00.000Z");
    });

    it("a dismissal sticks: the same contradiction is not raised again", async () => {
      const id = (await notices()).body.data.notices[0].id;
      const dismissed = await request(app)
        .post(`/api/v1/provenance/notices/${id}/dismiss`)
        .set("Cookie", cookie);
      expect(dismissed.status).toBe(200);
      expect((await notices()).body.data.total).toBe(0);
      expect(await prisma.provenanceNotice.count({ where: { userId, entryId: tripId } })).toBe(1);
    });

    it("a stranger sees no notice and cannot dismiss another account's", async () => {
      expect((await notices(strangerCookie)).body.data.total).toBe(0);
      const row = await prisma.provenanceNotice.findFirstOrThrow({ where: { userId } });
      const res = await request(app)
        .post(`/api/v1/provenance/notices/${row.id}/dismiss`)
        .set("Cookie", strangerCookie);
      expect(res.status).toBe(404);
    });

    it("resolves itself once the contradiction is gone, and the user fixed the trip, not the code", async () => {
      const u = (
        await prisma.user.create({
          data: { username: `rf-r-${stamp}`, passwordHash: await hashPassword("test-password") },
        })
      ).id;
      try {
        const c = `auth_token=${generateToken(u)}`;
        const t = await prisma.trip.create({
          data: {
            userId: u,
            name: "Herbst 2003",
            provenance: "remembered",
            startDate: new Date("2003-10-01T00:00:00Z"),
            endDate: new Date("2003-10-10T00:00:00Z"),
          },
        });
        await prisma.flight.create({
          data: {
            userId: u,
            tripId: t.id,
            depIata: "FRA",
            depLat: 50,
            depLon: 8,
            arrIata: "ROM",
            arrLat: 41,
            arrLon: 12,
            status: "flown",
            departureTime: new Date("2003-12-01T08:00:00Z"),
            provenance: "recorded",
          },
        });
        expect((await notices(c)).body.data.total).toBe(1);
        await prisma.trip.update({
          where: { id: t.id },
          data: { endDate: new Date("2003-12-05T00:00:00Z") },
        });
        expect((await notices(c)).body.data.total).toBe(0);
        const row = await prisma.provenanceNotice.findFirstOrThrow({ where: { userId: u } });
        expect(row.status).toBe("resolved");
      } finally {
        await prisma.user.delete({ where: { id: u } });
      }
    });

    it("also notices a remembered entry that lies outside a recorded trip", async () => {
      const u = (
        await prisma.user.create({
          data: { username: `rf-e-${stamp}`, passwordHash: await hashPassword("test-password") },
        })
      ).id;
      try {
        const c = `auth_token=${generateToken(u)}`;
        const t = await prisma.trip.create({
          data: {
            userId: u,
            name: "Lissabon",
            provenance: "recorded",
            startDate: new Date("2020-06-01T00:00:00Z"),
            endDate: new Date("2020-06-08T00:00:00Z"),
          },
        });
        await prisma.flight.create({
          data: {
            userId: u,
            tripId: t.id,
            depIata: "FRA",
            depLat: 50,
            depLon: 8,
            arrIata: "LIS",
            arrLat: 38,
            arrLon: -9,
            status: "flown",
            departureTime: new Date("2020-07-20T08:00:00Z"),
            provenance: "remembered",
          },
        });
        const list = (await notices(c)).body.data.notices;
        expect(list).toHaveLength(1);
        expect(list[0].kind).toBe("outsideRecordedSpan");
      } finally {
        await prisma.user.delete({ where: { id: u } });
      }
    });
  });
});

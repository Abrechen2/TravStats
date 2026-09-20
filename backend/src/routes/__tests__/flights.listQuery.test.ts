import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /flights` answers the questions the logbook page asks — on the server.
 *
 * Measured on 2026-09-20 (beta audit, board item "Logbuch Flüge: Seitengröße
 * ist nur Anzeige"): `FlightsTablePage.tsx` looped `limit=500` until the
 * account was exhausted and then did all of this in the browser, because the
 * endpoint had no free-text search, no trip filter, no special-type filter
 * and no sort. Every parameter below exists so that loop can go.
 *
 * Each case asserts the ROW SET and `total` together: a filter that narrows
 * the page but not the count is the exact defect that makes a pager lie.
 */
describe("GET /api/v1/flights — server-side search, filters and sort", () => {
  let user: { id: string };
  let authCookie: string;
  let tripId: string;
  const ids: Record<string, string> = {};

  const get = (query: Record<string, string | number>) =>
    request(app).get("/api/v1/flights").query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `flights-list-query-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const trip = await prisma.trip.create({
      data: { userId: user.id, name: `list query ${timestamp}`, color: "#818cf8" },
    });
    tripId = trip.id;

    const make = async (
      key: string,
      data: Parameters<typeof prisma.flight.create>[0]["data"]
    ): Promise<void> => {
      const row = await prisma.flight.create({ data });
      ids[key] = row.id;
    };

    // Four rows that differ in exactly the dimensions the filters address.
    await make("lh", {
      userId: user.id,
      tripId: trip.id,
      airline: "Lufthansa",
      airlineIata: "LH",
      flightNumber: "LH2462",
      depIata: "MUC",
      depName: "Munich",
      depLat: 48.3538,
      depLon: 11.7861,
      arrIata: "CPH",
      arrName: "Copenhagen Kastrup",
      arrLat: 55.6181,
      arrLon: 12.656,
      departureTime: new Date("2023-03-10T08:00:00Z"),
      status: "flown",
      price: 120,
    });
    await make("os", {
      userId: user.id,
      airline: "Austrian Airlines",
      airlineIata: "OS",
      flightNumber: "OS111",
      depIata: "VIE",
      depName: "Vienna Schwechat",
      depLat: 48.1103,
      depLon: 16.5697,
      arrIata: "ZRH",
      arrName: "Zurich",
      arrLat: 47.4647,
      arrLon: 8.5492,
      departureTime: new Date("2024-03-05T09:00:00Z"),
      status: "flown",
      price: 90,
    });
    await make("special", {
      userId: user.id,
      airline: "Aurora Flights",
      flightNumber: "AU1",
      depIata: "TOS",
      depName: "Tromso",
      depLat: 69.6833,
      depLon: 18.9189,
      arrIata: "TOS",
      arrName: "Tromso",
      arrLat: 69.6833,
      arrLon: 18.9189,
      departureTime: new Date("2024-11-02T20:00:00Z"),
      status: "flown",
      specialType: "aurora",
    });
    await make("undated", {
      userId: user.id,
      airline: "Lufthansa",
      airlineIata: "LH",
      flightNumber: "LH9999",
      depIata: "FRA",
      depName: "Frankfurt",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "JFK",
      arrName: "New York JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: null,
      status: "scheduled",
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.trip.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  const idsOf = (body: { flights: Array<{ id: string }> }): string[] =>
    body.flights.map((f) => f.id);

  describe("q — free text", () => {
    it("matches a flight number", async () => {
      const res = await get({ q: "lh2462" });
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toEqual([ids.lh]);
      expect(res.body.total).toBe(1);
    });

    it("matches an airline name case-insensitively", async () => {
      const res = await get({ q: "austrian" });
      expect(idsOf(res.body)).toEqual([ids.os]);
    });

    it("matches an airline IATA code", async () => {
      const res = await get({ q: "OS111" });
      expect(idsOf(res.body)).toContain(ids.os);
    });

    it("matches an airport code on either end", async () => {
      const res = await get({ q: "CPH" });
      expect(idsOf(res.body)).toEqual([ids.lh]);
    });

    it("matches an airport NAME, which no other parameter reaches", async () => {
      const res = await get({ q: "kastrup" });
      expect(idsOf(res.body)).toEqual([ids.lh]);
    });

    it("reports a total for the filtered set, not for the account", async () => {
      const res = await get({ q: "zzzz-no-such-flight" });
      expect(res.body.flights).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe("tripId", () => {
    it("selects one trip", async () => {
      const res = await get({ tripId });
      expect(idsOf(res.body)).toEqual([ids.lh]);
      expect(res.body.total).toBe(1);
    });

    it("`with` selects every assigned flight", async () => {
      const res = await get({ tripId: "with" });
      expect(idsOf(res.body)).toEqual([ids.lh]);
    });

    it("`without` selects every unassigned flight", async () => {
      const res = await get({ tripId: "without" });
      expect(idsOf(res.body).sort()).toEqual([ids.os, ids.special, ids.undated].sort());
      expect(res.body.total).toBe(3);
    });
  });

  describe("specialType", () => {
    it("selects one type", async () => {
      const res = await get({ specialType: "aurora" });
      expect(idsOf(res.body)).toEqual([ids.special]);
    });

    it("`special` selects every flight that has a type", async () => {
      const res = await get({ specialType: "special" });
      expect(idsOf(res.body)).toEqual([ids.special]);
    });

    it("`standard` selects every flight that has none", async () => {
      const res = await get({ specialType: "standard" });
      expect(idsOf(res.body)).not.toContain(ids.special);
      expect(res.body.total).toBe(3);
    });

    it("rejects a type that is not one of the eight", async () => {
      const res = await get({ specialType: "teleport" });
      expect(res.status).toBe(400);
    });
  });

  describe("year and month", () => {
    it("selects a calendar year in UTC", async () => {
      const res = await get({ year: 2023 });
      expect(idsOf(res.body)).toEqual([ids.lh]);
      expect(res.body.total).toBe(1);
    });

    it("narrows a year to one month", async () => {
      const res = await get({ year: 2024, month: 3 });
      expect(idsOf(res.body)).toEqual([ids.os]);
    });

    // The filter bar lets a month stand alone — "every March I have flown".
    // Prisma cannot express EXTRACT(MONTH ...), so this is the case that
    // resolves the account's year span and ORs one range per year.
    it("selects a month across every year when no year is named", async () => {
      const res = await get({ month: 3 });
      expect(idsOf(res.body).sort()).toEqual([ids.lh, ids.os].sort());
      expect(res.body.total).toBe(2);
    });

    it("leaves an undated flight out of any month or year", async () => {
      const res = await get({ month: 3 });
      expect(idsOf(res.body)).not.toContain(ids.undated);
    });
  });

  describe("sort and order", () => {
    it("defaults to newest departure first", async () => {
      const res = await get({});
      expect(idsOf(res.body).slice(0, 3)).toEqual([ids.special, ids.os, ids.lh]);
    });

    it("orders by airline", async () => {
      const res = await get({ sort: "airline", order: "asc" });
      const order = idsOf(res.body);
      expect(order.indexOf(ids.special)).toBeLessThan(order.indexOf(ids.os));
      expect(order.indexOf(ids.os)).toBeLessThan(order.indexOf(ids.lh));
    });

    it("orders by price with the priceless rows last in both directions", async () => {
      const asc = idsOf((await get({ sort: "price", order: "asc" })).body);
      expect(asc.slice(0, 2)).toEqual([ids.os, ids.lh]);
      const desc = idsOf((await get({ sort: "price", order: "desc" })).body);
      expect(desc.slice(0, 2)).toEqual([ids.lh, ids.os]);
      // Nulls last means last, not "first when the direction flips".
      expect(desc.slice(2).sort()).toEqual([ids.special, ids.undated].sort());
    });

    it("orders by route", async () => {
      const order = idsOf((await get({ sort: "route", order: "asc" })).body);
      expect(order.slice(0, 3)).toEqual([ids.undated, ids.lh, ids.special]);
    });

    it("rejects a sort key that is not whitelisted", async () => {
      const res = await get({ sort: "passwordHash" });
      expect(res.status).toBe(400);
    });

    /**
     * The tie-breaker, under a sort key that is anything but unique.
     *
     * `status` takes five values across a whole logbook, so ordering by it
     * alone leaves almost every row's position undefined — and an undefined
     * order across `skip`/`take` is what silently drops and repeats rows at a
     * page boundary. Walking the set one row at a time must therefore visit
     * every id exactly once.
     */
    it("pages without skipping or repeating a row under a coarse sort", async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < 4; offset += 1) {
        const res = await get({ sort: "status", order: "asc", limit: 1, offset });
        expect(res.body.total).toBe(4);
        expect(res.body.flights).toHaveLength(1);
        seen.push(res.body.flights[0].id);
      }
      expect(seen.sort()).toEqual([ids.lh, ids.os, ids.special, ids.undated].sort());
    });
  });

  describe("airlineExact", () => {
    it("matches the whole name, where `airline` matches a substring", async () => {
      const exact = await get({ airlineExact: "Lufthansa" });
      expect(idsOf(exact.body).sort()).toEqual([ids.lh, ids.undated].sort());

      const substring = await get({ airline: "Austrian" });
      expect(idsOf(substring.body)).toEqual([ids.os]);
      const noPartial = await get({ airlineExact: "Austrian" });
      expect(noPartial.body.flights).toEqual([]);
    });
  });
});

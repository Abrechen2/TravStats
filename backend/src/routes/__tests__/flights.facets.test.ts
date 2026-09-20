import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /flights/facets` — the option lists and figures drawn around the table.
 *
 * These two things are why the logbook could not paginate: the year and
 * airline dropdowns and the "N Flüge · N Airlines · N Flughäfen" strip were
 * all computed from the COMPLETE row set in the browser, so the page held
 * every flight the account owns regardless of what the table showed.
 *
 * The behaviour worth pinning is the faceting rule, because it is the one a
 * reasonable reading gets wrong: an option list is counted under every other
 * filter but NOT its own. Applying a facet to itself leaves the dropdown
 * holding only the value you picked, and there is no way back out of it.
 */
describe("GET /api/v1/flights/facets", () => {
  let user: { id: string };
  let authCookie: string;
  let tripId: string;

  const facets = (query: Record<string, string | number> = {}) =>
    request(app).get("/api/v1/flights/facets").query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `flights-facets-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const trip = await prisma.trip.create({
      data: { userId: user.id, name: `facets ${timestamp}`, color: "#818cf8" },
    });
    tripId = trip.id;

    const flight = (
      over: Partial<Parameters<typeof prisma.flight.create>[0]["data"]>
    ): Parameters<typeof prisma.flight.create>[0]["data"] => ({
      userId: user.id,
      depIata: "MUC",
      depLat: 48.3538,
      depLon: 11.7861,
      arrIata: "CPH",
      arrLat: 55.6181,
      arrLon: 12.656,
      status: "flown",
      ...over,
    });

    await prisma.flight.createMany({
      data: [
        // Two Lufthansa flights in 2023, one of them on the trip.
        flight({
          airline: "Lufthansa",
          airlineIata: "LH",
          departureTime: new Date("2023-05-01T08:00:00Z"),
          tripId: trip.id,
        }),
        flight({
          airline: "Lufthansa",
          airlineIata: "LH",
          departureTime: new Date("2023-06-01T08:00:00Z"),
          arrIata: "ZRH",
        }),
        // One Austrian flight in 2024, a different arrival airport.
        flight({
          airline: "Austrian Airlines",
          airlineIata: "OS",
          departureTime: new Date("2024-02-01T08:00:00Z"),
          arrIata: "VIE",
        }),
        // A row that names no carrier at all — it is not an airline, and the
        // strip has to say so rather than rank a carrier called "".
        flight({ airline: null, departureTime: new Date("2024-03-01T08:00:00Z") }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.trip.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("lists departure years with counts, newest first", async () => {
    const res = await facets();
    expect(res.status).toBe(200);
    expect(res.body.years).toEqual([
      { value: 2024, count: 2 },
      { value: 2023, count: 2 },
    ]);
  });

  it("lists carrier spellings with counts, most flights first", async () => {
    const { body } = await facets();
    expect(body.airlines).toEqual([
      { value: "Lufthansa", count: 2 },
      { value: "Austrian Airlines", count: 1 },
    ]);
  });

  it("leaves the nameless row out of the airline list", async () => {
    const { body } = await facets();
    expect(body.airlines.map((a: { value: string }) => a.value)).not.toContain("");
    expect(body.summary.withoutAirline).toBe(1);
  });

  it("summarises the filtered set — flights, carriers and airports", async () => {
    const { body } = await facets();
    expect(body.summary.flights).toBe(4);
    // Two carriers; the nameless row is not a third.
    expect(body.summary.airlines).toBe(2);
    // MUC on every row, plus CPH, ZRH and VIE.
    expect(body.summary.airports).toBe(4);
  });

  describe("faceting — a list is counted under every filter but its own", () => {
    it("keeps every carrier in the airline list when one carrier is picked", async () => {
      const { body } = await facets({ airlineExact: "Lufthansa" });
      expect(body.airlines).toEqual([
        { value: "Lufthansa", count: 2 },
        { value: "Austrian Airlines", count: 1 },
      ]);
      // …while everything else DOES narrow: that is the point of the rule.
      expect(body.years).toEqual([{ value: 2023, count: 2 }]);
      expect(body.summary.flights).toBe(2);
    });

    it("keeps every year in the year list when one year is picked", async () => {
      const { body } = await facets({ year: 2023 });
      expect(body.years).toEqual([
        { value: 2024, count: 2 },
        { value: 2023, count: 2 },
      ]);
      expect(body.airlines).toEqual([{ value: "Lufthansa", count: 2 }]);
      expect(body.summary.flights).toBe(2);
    });
  });

  it("honours the same filters the list endpoint takes", async () => {
    const byTrip = await facets({ tripId });
    expect(byTrip.body.summary.flights).toBe(1);
    expect(byTrip.body.years).toEqual([{ value: 2023, count: 1 }]);

    const bySearch = await facets({ q: "austrian" });
    expect(bySearch.body.summary.flights).toBe(1);
    expect(bySearch.body.years).toEqual([{ value: 2024, count: 1 }]);
  });

  it("answers an empty account with empty lists, not with an error", async () => {
    const { body } = await facets({ q: "no-such-flight-anywhere" });
    expect(body.years).toEqual([]);
    expect(body.airlines).toEqual([]);
    expect(body.summary).toEqual({
      flights: 0,
      airlines: 0,
      airports: 0,
      withoutAirline: 0,
    });
  });

  it("needs a session", async () => {
    const res = await request(app).get("/api/v1/flights/facets");
    expect(res.status).toBe(401);
  });

  // "/facets" must not be read as a flight id. Registration order decides
  // that, and nothing else would notice if it were reversed.
  it("is not swallowed by the /:id route", async () => {
    const res = await facets();
    expect(res.body).toHaveProperty("summary");
  });
});

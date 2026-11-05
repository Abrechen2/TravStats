import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { pickRailAndFlyFlight } from "../../services/rail/railAndFly";

/**
 * Rail&Fly (owner ruling 2026-11-05): an imported train ticket is tied to the
 * flight it feeds — same trip, within a day, ending near the airport — and the
 * flight shows the ticket back. A flight booking alone proposes nothing, and an
 * unrelated flight is never picked.
 */
const KOELN_HBF = { name: "Koeln Hbf", lat: 50.943, lon: 6.959, country: "DE" };
const FRA_FERNBF = { name: "Frankfurt Flughafen Fernbf", lat: 50.053, lon: 8.571, country: "DE" };

describe("Rail&Fly links a ticket to its flight", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  const flight = (over: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH400",
        airline: "Lufthansa",
        depIata: "FRA",
        depLat: 50.033,
        depLon: 8.57,
        arrIata: "JFK",
        arrLat: 40.64,
        arrLon: -73.78,
        departureTime: new Date("2026-09-10T10:00:00Z"),
        arrivalTime: new Date("2026-09-10T18:00:00Z"),
        status: "scheduled",
        tripId,
        ...over,
      },
    });

  const ticket = (over: Record<string, unknown> = {}) => ({
    trainCategory: "ICE",
    trainNumber: "1051",
    operator: "DB Fernverkehr",
    departureStation: KOELN_HBF,
    arrivalStation: FRA_FERNBF,
    departureLocal: "2026-09-10T06:30",
    arrivalLocal: "2026-09-10T08:00",
    bookingReference: "ZZ99XX",
    ...over,
  });

  const post = (body: object) => request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `rail-fly-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rail"], data: {} },
    });
    tripId = (await prisma.trip.create({ data: { userId, name: "NYC", status: "planned" } })).id;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("ties a ticket ending at the departure airport the day before to that flight, both ways", async () => {
    const f = await flight();
    const res = await post(
      ticket({ departureLocal: "2026-09-09T20:30", arrivalLocal: "2026-09-09T22:00" })
    );
    expect(res.status).toBe(201);
    expect(res.body.data.railAndFlyFlightId).toBe(f.id);
    expect(res.body.data.railAndFlyFlight).toMatchObject({ id: f.id, flightNumber: "LH400" });

    const back = await request(app).get(`/api/v1/flights/${f.id}`).set("Cookie", cookie);
    expect(back.status).toBe(200);
    expect(back.body.railAndFlyRides.map((r: { id: string }) => r.id)).toEqual([res.body.data.id]);
  });

  it("does not tie a ticket to an unrelated flight: wrong airport, wrong week, other trip", async () => {
    await flight({ depIata: "BER", depLat: 52.36, depLon: 13.5 }); // ride ends in Frankfurt
    await flight({ departureTime: new Date("2026-09-20T10:00:00Z"), arrivalTime: null });
    const other = await prisma.trip.create({ data: { userId, name: "Other", status: "planned" } });
    await flight({ tripId: other.id });
    const res = await post(ticket({ tripId }));
    expect(res.status).toBe(201);
    expect(res.body.data.railAndFlyFlightId).toBeNull();
  });

  it("makes no link for a ride typed in without a ticket", async () => {
    await flight();
    const res = await post(ticket({ bookingReference: null }));
    expect(res.status).toBe(201);
    expect(res.body.data.railAndFlyFlightId).toBeNull();
  });

  it("links a flight saved AFTER its ticket, by the same rule, and not an unrelated one", async () => {
    const res = await post(ticket());
    expect(res.body.data.railAndFlyFlightId).toBeNull();

    const far = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({
        flightNumber: "LH999",
        airline: "Lufthansa",
        departure: { iata: "BER", name: "Berlin", lat: 52.36, lon: 13.5 },
        arrival: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
        departureLocal: "2026-09-10T10:00",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2026-09-10T13:00",
        arrTimezone: "America/New_York",
        status: "scheduled",
      });
    expect(far.status).toBe(201);
    const near = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({
        flightNumber: "LH400",
        airline: "Lufthansa",
        departure: { iata: "FRA", name: "Frankfurt", lat: 50.033, lon: 8.57 },
        arrival: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
        departureLocal: "2026-09-10T10:00",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2026-09-10T13:00",
        arrTimezone: "America/New_York",
        status: "scheduled",
      });
    expect(near.status).toBe(201);

    const ride = await prisma.railJourney.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(ride.railAndFlyFlightId).toBe(near.body.flight?.id ?? near.body.id);
    const back = await request(app)
      .get(`/api/v1/flights/${ride.railAndFlyFlightId}`)
      .set("Cookie", cookie);
    expect(back.body.railAndFlyRides.map((r: { id: string }) => r.id)).toEqual([ride.id]);
  });

  it("leaves the ride when the flight is deleted", async () => {
    const f = await flight();
    const res = await post(ticket());
    expect(res.body.data.railAndFlyFlightId).toBe(f.id);
    await prisma.flight.delete({ where: { id: f.id } });
    const after = await prisma.railJourney.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(after.railAndFlyFlightId).toBeNull();
  });
});

describe("pickRailAndFlyFlight", () => {
  const ride = {
    tripId: null,
    departureTime: new Date("2026-09-10T06:30:00Z"),
    depLat: 50.943,
    depLon: 6.959,
    arrLat: 50.053,
    arrLon: 8.571,
  };
  const at = (id: string, dep: string) => ({
    id,
    tripId: null,
    departureTime: new Date(dep),
    arrivalTime: null,
    depLat: 50.033,
    depLon: 8.57,
    arrLat: 40.64,
    arrLon: -73.78,
  });

  it("takes the closer day and names none on a perfect tie", () => {
    expect(
      pickRailAndFlyFlight(ride, [
        at("far", "2026-09-11T10:00:00Z"),
        at("near", "2026-09-10T10:00:00Z"),
      ])
    ).toBe("near");
    expect(
      pickRailAndFlyFlight(ride, [at("a", "2026-09-10T10:00:00Z"), at("b", "2026-09-10T11:00:00Z")])
    ).toBeNull();
  });

  it("never reaches a flight two days away", () => {
    expect(pickRailAndFlyFlight(ride, [at("x", "2026-09-12T10:00:00Z")])).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rankDestinations } from "../trips/entrySuggestions";

/**
 * `GET /trips/entry-suggestions` — the trip form's origin and destination
 * offers. Pinned: the home airport is named by its airport name, never the
 * catalogue's municipality; a flight back home or back to the start is no
 * destination; and another account's trip answers 404, not its places.
 */

// Codes no real catalogue row uses, so the test owns every airport it reads.
const HOME = "Q7H";
const AWAY = "Q7A";

describe("rankDestinations", () => {
  it("ranks by count, then by the order the trip got there, case-insensitively", () => {
    expect(
      rankDestinations(
        [{ city: "Kyoto" }, { city: "Tokyo" }, { city: "tokyo" }, { city: " " }, { city: null }],
        4
      )
    ).toEqual(["Tokyo", "Kyoto"]);
  });

  it("adds a country only when two named cities share it", () => {
    expect(
      rankDestinations(
        [
          { city: "Tokyo", country: "Japan" },
          { city: "Kyoto", country: "Japan" },
          { city: "Seoul", country: "South Korea" },
        ],
        4
      )
    ).toEqual(["Tokyo", "Kyoto", "Seoul", "Japan"]);
    expect(rankDestinations([{ city: "Tokyo", country: "Japan" }], 4)).toEqual(["Tokyo"]);
  });
});

describe("GET /api/v1/trips/entry-suggestions", () => {
  let user: { id: string };
  let other: { id: string };
  let tripId: string;
  let otherTripId: string;
  let portId: number;
  let authCookie: string;

  const suggest = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/trips/entry-suggestions").query(query).set("Cookie", authCookie);

  type FlightData = Parameters<typeof prisma.flight.create>[0]["data"];
  const flight = (over: Partial<FlightData>): FlightData => ({
    userId: user.id,
    depLat: 0,
    depLon: 0,
    arrLat: 1,
    arrLon: 1,
    status: "flown",
    ...over,
  });

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("trip-sugg");
    other = await make("trip-sugg-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.airport.createMany({
      data: [
        // The municipality trap: `city` is where the runway sits, not the city.
        {
          iata: HOME,
          name: "Testhausen International Airport",
          city: "Runwaydorf",
          lat: 0,
          lon: 0,
        },
        { iata: AWAY, name: "Farville Airport", city: "Nowhere", lat: 1, lon: 1 },
      ],
    });
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        data: { homeAirportHistory: [{ iata: HOME, fromDate: "2000-01-01", toDate: null }] },
      },
      update: {
        data: { homeAirportHistory: [{ iata: HOME, fromDate: "2000-01-01", toDate: null }] },
      },
    });

    const trip = await prisma.trip.create({
      data: { userId: user.id, name: "Away", color: "#fff" },
    });
    tripId = trip.id;
    const otherTrip = await prisma.trip.create({
      data: { userId: other.id, name: "Secret", color: "#fff" },
    });
    otherTripId = otherTrip.id;

    await prisma.flight.createMany({
      data: [
        flight({
          tripId,
          depIata: HOME,
          arrIata: AWAY,
          arrName: "Farville Airport",
          departureTime: new Date("2025-05-01T08:00:00Z"),
        }),
        // The way home: arrives at the home airport, so it names no destination.
        flight({
          tripId,
          depIata: AWAY,
          arrIata: HOME,
          arrName: "Testhausen International Airport",
          departureTime: new Date("2025-05-09T08:00:00Z"),
        }),
      ],
    });

    const lodging = await prisma.lodging.create({
      data: { userId: user.id, name: "Inn", city: "Farville", country: "Farland" },
    });
    const lodging2 = await prisma.lodging.create({
      data: { userId: user.id, name: "Lodge", city: "Lakeside", country: "Farland" },
    });
    await prisma.lodgingStay.createMany({
      data: [
        { userId: user.id, lodgingId: lodging.id, tripId, checkIn: new Date("2025-05-01") },
        { userId: user.id, lodgingId: lodging2.id, tripId, checkIn: new Date("2025-05-05") },
      ],
    });

    const port = await prisma.port.create({
      data: { name: "Harbour Pier", city: "Portton", country: "Farland", lat: 2, lon: 2 },
    });
    portId = port.id;
    await prisma.cruise.create({
      data: { userId: user.id, tripId, arrivalPortId: portId, startDate: new Date("2025-05-06") },
    });
    // Another account's stay in a city the user never went to.
    const foreign = await prisma.lodging.create({
      data: { userId: other.id, name: "Elsewhere", city: "Secretville" },
    });
    await prisma.lodgingStay.create({
      data: { userId: other.id, lodgingId: foreign.id, tripId: otherTripId },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
    await prisma.port.deleteMany({ where: { id: portId } });
    await prisma.airport.deleteMany({ where: { iata: { in: [HOME, AWAY] } } });
  });

  it("offers the home airport by its name, not by its municipality", async () => {
    const res = await suggest();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ origins: ["Testhausen"], destinations: [] });
  });

  it("offers the trip's destinations: stays, the cruise's end port, the outbound flight", async () => {
    const res = await suggest({ tripId });
    expect(res.status).toBe(200);
    // Farville twice (a stay and the outbound flight's airport); the flight home
    // to Testhausen is absent; Farland spans two named cities.
    expect(res.body.destinations).toEqual(["Farville", "Lakeside", "Portton", "Farland"]);
    expect(res.body.destinations).not.toContain("Testhausen");
  });

  it("answers another account's trip with 404, not its places", async () => {
    const res = await suggest({ tripId: otherTripId });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Secretville");
  });

  it("rejects a trip id that is no uuid", async () => {
    expect((await suggest({ tripId: "nope" })).status).toBe(400);
  });
});

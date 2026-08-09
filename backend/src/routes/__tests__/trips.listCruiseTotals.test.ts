import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A trip made only of cruises showed "— km" and "— Gesamtkosten" while the data
 * existed: the cruise carried a price and its legs carried distances. The trip
 * LIST payload simply never shipped either — the nested cruise select stopped at
 * id/line/dates/status/ship, so the card had nothing to sum.
 *
 * These pin the payload the card needs.
 */
describe("the trip list carries cruise price and distance", () => {
  let authCookie: string;
  let userId: string;
  let tripId: string;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripCruiseTotals" } });
    const user = await prisma.user.create({
      data: {
        username: "tripCruiseTotals",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    const a = await prisma.port.upsert({
      where: { unlocode: "XXTSA" },
      update: {},
      create: { name: "Test Port A", unlocode: "XXTSA", lat: 53.5, lon: 9.9 },
    });
    const b = await prisma.port.upsert({
      where: { unlocode: "XXTSB" },
      update: {},
      create: { name: "Test Port B", unlocode: "XXTSB", lat: 59.9, lon: 10.7 },
    });
    portA = a.id;
    portB = b.id;

    const trip = await prisma.trip.create({
      data: { userId, name: "Cruise-only trip", status: "completed" },
    });
    tripId = trip.id;

    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId,
        cruiseLine: "Test Line",
        status: "completed",
        price: 1290,
        currency: "EUR",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-03-08T00:00:00.000Z"),
      },
    });

    await prisma.cruiseLeg.createMany({
      data: [
        {
          cruiseId: cruise.id,
          ordinal: 1,
          fromPortId: portA,
          toPortId: portB,
          distanceKm: 800,
          method: "test",
          routerVersion: "test",
        },
        {
          cruiseId: cruise.id,
          ordinal: 2,
          fromPortId: portB,
          toPortId: portA,
          distanceKm: 700,
          method: "test",
          routerVersion: "test",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { unlocode: { in: ["XXTSA", "XXTSB"] } } });
  });

  it("ships the cruise price, currency and bookingId so the card can total them", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(trip).toBeDefined();
    expect(trip.cruises).toHaveLength(1);
    expect(trip.cruises[0].price).toBe(1290);
    expect(trip.cruises[0].currency).toBe("EUR");
    expect(trip.cruises[0]).toHaveProperty("bookingId");
  });

  it("ships the summed leg distance per cruise", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(trip.cruises[0].distanceKm).toBe(1500);
  });

  it("reports zero distance for a cruise whose legs were never computed", async () => {
    const bare = await prisma.cruise.create({
      data: { userId, tripId, cruiseLine: "No legs", status: "completed" },
    });

    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    const found = trip.cruises.find((c: { id: string }) => c.id === bare.id);
    expect(found.distanceKm).toBe(0);

    await prisma.cruise.delete({ where: { id: bare.id } });
  });
});

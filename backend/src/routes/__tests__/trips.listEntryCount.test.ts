import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#169 — a trip holding one linked train ride showed "Bahn – 1 Fahrt"
 * on its page and "0 Einträge" on its card. The list's `_count` stopped at
 * flights, cruises and stays, so the card had nothing to count the other
 * areas the trip page lists with: rail, rentals (a cancelled one excluded,
 * as on the page) and roadtrips.
 */
describe("the trip list counts every area the trip page lists (forgejo#169)", () => {
  let authCookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripEntryCount" } });
    const user = await prisma.user.create({
      data: { username: "tripEntryCount", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    const trip = await prisma.trip.create({
      data: { userId, name: "QA Herbstreise", status: "planned" },
    });
    tripId = trip.id;

    await prisma.railJourney.create({
      data: {
        userId,
        tripId,
        depStationName: "München Hbf",
        arrStationName: "Berlin Hbf",
        depLat: 48.14,
        depLon: 11.56,
        arrLat: 52.52,
        arrLon: 13.37,
        departureTime: new Date("2026-10-15T06:00:00Z"),
        depTimezone: "Europe/Berlin",
        status: "planned",
      },
    });
    const rental = (status: string) =>
      prisma.rentalBooking.create({
        data: {
          userId,
          tripId,
          provider: "Testcar",
          pickupStationName: "Berlin Hbf",
          pickupLat: 52.52,
          pickupLon: 13.37,
          pickupTimezone: "Europe/Berlin",
          returnStationName: "Berlin Hbf",
          returnLat: 52.52,
          returnLon: 13.37,
          returnTimezone: "Europe/Berlin",
          pickupTime: new Date("2026-10-16T08:00:00Z"),
          returnTime: new Date("2026-10-18T08:00:00Z"),
          status,
        },
      });
    await rental("scheduled");
    await rental("cancelled");
    await prisma.tripRoute.createMany({
      data: [
        { userId, tripId, name: "Ostsee", mode: "road", orderIdx: 0, kind: "roadtrip" },
        { userId, tripId, name: "Stadtrundgang", mode: "foot", orderIdx: 1, kind: "tour" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reports the train ride, the one live rental and the roadtrip", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(trip._count).toMatchObject({
      flights: 0,
      cruises: 0,
      lodgingStays: 0,
      railJourneys: 1,
      rentalBookings: 1,
      roadtrips: 1,
      routes: 2,
    });
  });
});

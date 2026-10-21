import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * beta.22 UAT: the trip map drew no train ride and no rental car, because
 * `GET /trips/:id` sent neither's coordinates — a rail row carried station
 * names only, a rental its two branch names. The map needs the ends, the
 * stored line and the rental's one-way flag to draw what the dashboard draws.
 */
const USER = "tripmaptransport";

describe("GET /trips/:id — what the trip map draws of rail and rentals", () => {
  let cookie: string;
  let tripId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.railJourney.deleteMany({ where: { user: { username: USER } } });
    await prisma.rentalBooking.deleteMany({ where: { user: { username: USER } } });
    await prisma.trip.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    tripId = (await prisma.trip.create({ data: { userId: u.id, name: "Norway" } })).id;
    await prisma.railJourney.create({
      data: {
        userId: u.id,
        tripId,
        depStationName: "Hamburg Hbf",
        depLat: 53.55,
        depLon: 10.0,
        depTimezone: "Europe/Berlin",
        arrStationName: "Kiel Hbf",
        arrLat: 54.31,
        arrLon: 10.13,
        arrTimezone: "Europe/Berlin",
        departureTime: new Date("2027-08-10T08:00:00Z"),
        geometry: [
          [10.0, 53.55],
          [10.05, 54.0],
          [10.13, 54.31],
        ],
        geometrySource: "manual",
        status: "completed",
      },
    });
    await prisma.rentalBooking.create({
      data: {
        userId: u.id,
        tripId,
        provider: "Testcar",
        pickupStationName: "Oslo Lufthavn",
        pickupLat: 60.19,
        pickupLon: 11.1,
        pickupTimezone: "Europe/Oslo",
        returnStationName: "Bergen Lufthavn",
        returnLat: 60.29,
        returnLon: 5.22,
        returnTimezone: "Europe/Oslo",
        pickupTime: new Date("2027-08-12T09:00:00Z"),
        returnTime: new Date("2027-08-15T09:00:00Z"),
        status: "completed",
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("sends each train ride's ends and stored line, and each rental's branches", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie).expect(200);
    const [rail] = res.body.trip.railJourneys;
    expect(rail).toMatchObject({
      depLat: 53.55,
      depLon: 10.0,
      arrLat: 54.31,
      arrLon: 10.13,
      geometrySource: "manual",
    });
    expect(rail.geometry).toHaveLength(3);
    const [rental] = res.body.trip.rentalBookings;
    expect(rental).toMatchObject({
      pickupLat: 60.19,
      pickupLon: 11.1,
      returnLat: 60.29,
      returnLon: 5.22,
      oneWay: true,
      routeId: null,
    });
  });
});

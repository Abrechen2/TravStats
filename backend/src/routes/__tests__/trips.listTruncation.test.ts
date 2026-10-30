import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { TRIPS_LIST_CAP } from "../../services/trip/tripsListInclude";

/**
 * forgejo#385 (RULE-24): GET /trips stopped at 500 trips and 200 flights per
 * trip with nothing in the body to say so; a client showed a partial list as
 * the whole one. The body now carries `total`/`truncated` and a per-trip
 * `flightsTruncated`.
 */
describe("GET /trips says when it stopped short", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripsTruncation" } });
    const user = await prisma.user.create({
      data: { username: "tripsTruncation", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reports total and truncated=false when everything fits", async () => {
    await prisma.trip.create({ data: { userId, name: "One", status: "completed" } });
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(res.body.total).toBe(1);
    expect(res.body.truncated).toBe(false);
    expect(res.body.trips[0].flightsTruncated).toBe(false);
  });

  it("flags a trip whose flight list was capped at 200", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Many", status: "completed" } });
    await prisma.flight.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({
        userId,
        tripId: trip.id,
        depLat: 50,
        depLon: 8,
        arrLat: 51,
        arrLon: 0,
        depIata: "FRA",
        arrIata: "LHR",
        departureTime: new Date(Date.UTC(2024, 0, 1, 0, i)),
        status: "flown",
      })),
    });
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    const many = res.body.trips.find((t: { id: string }) => t.id === trip.id);
    expect(many.flights).toHaveLength(200);
    expect(many.flightsTruncated).toBe(true);
  });

  it("reports the true total once the list is capped", async () => {
    const have = await prisma.trip.count({ where: { userId } });
    await prisma.trip.createMany({
      data: Array.from({ length: TRIPS_LIST_CAP + 5 - have }, (_, i) => ({
        userId,
        name: `Bulk ${i}`,
        status: "completed",
      })),
    });
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(res.body.trips).toHaveLength(TRIPS_LIST_CAP);
    expect(res.body.total).toBe(TRIPS_LIST_CAP + 5);
    expect(res.body.truncated).toBe(true);
  });
});

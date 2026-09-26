import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Rail reaches the passport, the country drill-down and the year in review
 * (2.7). The Stats overview already counted a ride's countries; before this the
 * passport on the same account did not know them, and a year of train rides had
 * no story at all.
 */
describe("stats — rail as evidence and as a year", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statsrail" } });
    const user = await prisma.user.create({
      data: { username: "statsrail", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    await prisma.railJourney.createMany({
      data: [
        {
          userId,
          status: "completed",
          trainCategory: "ICE",
          trainNumber: "5",
          depStationName: "Frankfurt (Main) Hbf",
          depLat: 50.107,
          depLon: 8.663,
          depCountry: "DE",
          depTimezone: "Europe/Berlin",
          arrStationName: "Basel SBB",
          arrLat: 47.547,
          arrLon: 7.589,
          arrCountry: "CH",
          arrTimezone: "Europe/Zurich",
          departureTime: new Date("2025-03-01T07:00:00Z"),
          arrivalTime: new Date("2025-03-01T10:00:00Z"),
          distanceKm: 262,
          distanceSource: "great_circle",
        },
        {
          // Cancelled: proves nothing, anywhere.
          userId,
          status: "cancelled",
          depStationName: "Basel SBB",
          depLat: 47.547,
          depLon: 7.589,
          depCountry: "CH",
          arrStationName: "Milano Centrale",
          arrLat: 45.486,
          arrLon: 9.204,
          arrCountry: "IT",
          departureTime: new Date("2025-03-02T07:00:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("puts a country reached only by train in the passport", async () => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const codes = res.body.countries.map((c: { code: string }) => c.code).sort();
    expect(codes).toEqual(["CH", "DE"]);
    expect(res.body.countries.find((c: { code: string }) => c.code === "CH")).toMatchObject({
      evidence: "rail",
      kinds: ["rail"],
    });
  });

  it("names the ride behind that country", async () => {
    const res = await request(app).get("/api/v1/stats/countries/CH").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ evidence: "rail", railRides: 1 });
    expect(res.body.timeline[0]).toMatchObject({ kind: "rail", stationName: "Basel SBB" });
    expect(
      (await request(app).get("/api/v1/stats/countries/IT").set("Cookie", cookie)).status
    ).toBe(404);
  });

  it("tells a year of train rides, with its new countries", async () => {
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2025,
      flights: 0,
      railRides: 1,
      railKm: 262,
      railStraightLineKm: 262,
      newCountries: 2,
    });
  });
});

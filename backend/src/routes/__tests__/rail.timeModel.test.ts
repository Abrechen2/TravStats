import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * ADR 0002 phase 2 for rail: a station's zone comes from the station
 * CATALOGUE first and its coordinates second (D2), and a ride records the
 * precision of its times.
 */
const USER = "railtimemodel";
const PARIS = { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" };

describe("Rail — time model (phase 2)", () => {
  let cookie: string;
  let stationId: number;

  const cleanup = async (): Promise<void> => {
    await prisma.railJourney.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.railStation.deleteMany({ where: { searchName: "tm catalogue zone" } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    // A catalogue row whose zone says something its coordinates (Frankfurt)
    // would not: the catalogue is the authority when it names one.
    stationId = (
      await prisma.railStation.create({
        data: {
          name: "TM Catalogue Zone",
          searchName: "tm catalogue zone",
          lat: 50.1071,
          lon: 8.6632,
          timezone: "Europe/London",
          isUserAdded: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("reads the departure on the CATALOGUE's zone and records the precision", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        operator: "Test",
        departureStation: { stationId, name: "TM Catalogue Zone", lat: 50.1071, lon: 8.6632 },
        arrivalStation: PARIS,
        departureLocal: "2027-07-01T08:15",
        arrivalLocal: "2027-07-01T12:09",
      });
    expect(res.status).toBe(201);
    const id = res.body.id ?? res.body.data?.id ?? res.body.journey?.id;
    const row = await prisma.railJourney.findUniqueOrThrow({ where: { id } });
    expect(row.depTimezone).toBe("Europe/London");
    expect(row.departureTime.toISOString()).toBe("2027-07-01T07:15:00.000Z");
    expect(row.arrTimezone).toBe("Europe/Paris");
    expect(row.depPrecision).toBe("minute");
    expect(row.arrPrecision).toBe("minute");
  });
});

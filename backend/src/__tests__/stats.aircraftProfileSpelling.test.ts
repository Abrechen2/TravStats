/**
 * forgejo#340: the per-tail profile narrows to the one hull in SQL, and still
 * matches every spelling the ranking keys by (case, spaces) — and nothing else.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "aircraftprofilespelling";
const LEG = {
  depIata: "MUC",
  arrIata: "TXL",
  depLat: 48.3538,
  depLon: 11.7861,
  arrLat: 52.5597,
  arrLon: 13.2877,
  status: "flown",
  aircraft: "A320",
};

describe("aircraft profile — SQL narrowing keeps every spelling of the hull", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    const day = (n: number) => new Date(Date.UTC(2025, 5, n, 8));
    await prisma.flight.createMany({
      data: [
        { ...LEG, userId: user.id, aircraftRegistration: "D-AIZZ", departureTime: day(1) },
        { ...LEG, userId: user.id, aircraftRegistration: "d-aizz", departureTime: day(2) },
        { ...LEG, userId: user.id, aircraftRegistration: " D-A IZZ ", departureTime: day(3) },
        { ...LEG, userId: user.id, aircraftRegistration: "D-AIZY", departureTime: day(4) },
        { ...LEG, userId: user.id, aircraftRegistration: "D-AIZZZ", departureTime: day(5) },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("counts the three spellings of D-AIZZ and not the neighbours", async () => {
    const res = await request(app).get("/api/v1/stats/aircraft/D-AIZZ").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.flightCount).toBe(3);
    expect(
      res.body.flights.map((f: { departureTime: string }) => f.departureTime.slice(0, 10))
    ).toEqual(["2025-06-03", "2025-06-02", "2025-06-01"]);
  });

  it("answers 404 for a hull the account never flew", async () => {
    const res = await request(app).get("/api/v1/stats/aircraft/D-NONE").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

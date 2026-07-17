import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

// ZZ8 is absent from both data/openflights/planes.dat and src/data/aircraftTypes.ts,
// so the created row can never collide with a seeded catalogue aircraft. Distinct
// from seedAircraftFromData.test.ts's ZZ9 so the two suites can never interfere.
// The beforeAll delete makes the suite self-healing after a crashed prior run.
const THROWAWAY_ICAO = "ZZ8";

describe("Aircraft API", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.aircraft.deleteMany({ where: { icao: THROWAWAY_ICAO } });
    await prisma.user.deleteMany({ where: { username: "aircrafttest" } });
    const user = await prisma.user.create({
      data: { username: "aircrafttest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.aircraft.deleteMany({ where: { icao: THROWAWAY_ICAO } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/aircraft", () => {
    it("finds Airbus A320 by q", async () => {
      const res = await request(app).get("/api/v1/aircraft?q=a320").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(
        res.body.data.some((a: { icao: string; name: string }) => a.icao === "A320" && a.name === "Airbus A320")
      ).toBe(true);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/aircraft");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/aircraft", () => {
    it("creates a user-added aircraft", async () => {
      const res = await request(app)
        .post("/api/v1/aircraft")
        .set("Cookie", authCookie)
        .send({ icao: THROWAWAY_ICAO, name: "Test Craft" });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      expect(res.body.data.icao).toBe(THROWAWAY_ICAO);
      expect(res.body.data.name).toBe("Test Craft");

      const listRes = await request(app).get("/api/v1/aircraft?q=test").set("Cookie", authCookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((a: { icao: string }) => a.icao === THROWAWAY_ICAO)).toBe(
        true
      );
    });

    it("returns 409 for a duplicate ICAO (seeded type)", async () => {
      const res = await request(app)
        .post("/api/v1/aircraft")
        .set("Cookie", authCookie)
        .send({ icao: "A320", name: "Airbus A320 Again" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DUPLICATE");
    });

    it("rejects a missing name", async () => {
      const res = await request(app)
        .post("/api/v1/aircraft")
        .set("Cookie", authCookie)
        .send({ icao: "ZZ7" });
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app).post("/api/v1/aircraft").send({ icao: "ZZ7", name: "X" });
      expect(res.status).toBe(401);
    });
  });
});

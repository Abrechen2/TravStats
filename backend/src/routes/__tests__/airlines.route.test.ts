import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

// Q1 is absent from both data/openflights/airlines.dat and src/data/airlines.ts,
// so the created row can never collide with a seeded catalogue airline (Q2 is
// real: Maldivian). Distinct from seedAirlinesFromData.test.ts's Q0 so the two
// suites can never interfere. The beforeAll delete makes the suite self-healing
// after a crashed prior run.
const THROWAWAY_IATA = "Q1";

describe("Airlines API", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.airline.deleteMany({ where: { iata: THROWAWAY_IATA } });
    await prisma.user.deleteMany({ where: { username: "airlinetest" } });
    const user = await prisma.user.create({
      data: { username: "airlinetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.airline.deleteMany({ where: { iata: THROWAWAY_IATA } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/airlines", () => {
    it("finds Lufthansa by q", async () => {
      const res = await request(app).get("/api/v1/airlines?q=luft").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(
        res.body.data.some((a: { iata: string; name: string }) => a.iata === "LH" && a.name === "Lufthansa")
      ).toBe(true);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/airlines");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/airlines", () => {
    it("creates a user-added airline", async () => {
      const res = await request(app)
        .post("/api/v1/airlines")
        .set("Cookie", authCookie)
        .send({ iata: THROWAWAY_IATA, name: "Test Air" });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      expect(res.body.data.iata).toBe(THROWAWAY_IATA);
      expect(res.body.data.name).toBe("Test Air");

      const listRes = await request(app).get("/api/v1/airlines?q=test").set("Cookie", authCookie);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((a: { iata: string }) => a.iata === THROWAWAY_IATA)).toBe(
        true
      );
    });

    it("rejects a missing name", async () => {
      const res = await request(app)
        .post("/api/v1/airlines")
        .set("Cookie", authCookie)
        .send({ iata: "ZZ" });
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app).post("/api/v1/airlines").send({ iata: "ZZ", name: "X" });
      expect(res.status).toBe(401);
    });
  });
});

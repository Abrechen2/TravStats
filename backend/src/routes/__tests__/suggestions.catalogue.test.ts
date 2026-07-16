import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Suggestions API (DB-backed catalogue)", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "suggestionscataloguetest" } });
    const user = await prisma.user.create({
      data: { username: "suggestionscataloguetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/suggestions/airlines", () => {
    it("returns a capped, filtered list matching q", async () => {
      const res = await request(app)
        .get("/api/v1/suggestions/airlines?q=luft")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body.suggestions).toContain("Lufthansa");
      expect(res.body.suggestions.length).toBeLessThanOrEqual(50);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/suggestions/airlines");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/suggestions/aircraft", () => {
    it("returns a capped, filtered list matching q", async () => {
      const res = await request(app)
        .get("/api/v1/suggestions/aircraft?q=airbus")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body.suggestions.length).toBeGreaterThan(0);
      expect(res.body.suggestions.length).toBeLessThanOrEqual(50);
      for (const name of res.body.suggestions) {
        expect(String(name).toLowerCase()).toContain("airbus");
      }
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/suggestions/aircraft");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/suggestions/airlines without q", () => {
    it("does not dump the whole static catalogue (capped)", async () => {
      const res = await request(app)
        .get("/api/v1/suggestions/airlines")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.suggestions.length).toBeLessThanOrEqual(50);
    });
  });
});

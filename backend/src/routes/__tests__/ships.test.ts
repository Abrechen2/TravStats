import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Ships API", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "shiptest" } });
    const user = await prisma.user.create({
      data: { username: "shiptest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.ship.deleteMany({ where: { isUserAdded: true } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/ships", () => {
    it("filters by q (name or cruiseLine, case-insensitive)", async () => {
      const res = await request(app).get("/api/v1/ships?q=aida").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (s: { name: string; cruiseLine: string }) =>
            s.name.toLowerCase().includes("aida") ||
            s.cruiseLine.toLowerCase().includes("aida")
        )
      ).toBe(true);
    });

    it("filters by cruiseLine exactly", async () => {
      const res = await request(app)
        .get("/api/v1/ships?cruiseLine=TUI%20Cruises")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((s: { cruiseLine: string }) => s.cruiseLine === "TUI Cruises")
      ).toBe(true);
    });

    it("exact IMO match ranks first", async () => {
      // Pick an existing IMO from the DB so the assertion is stable.
      const sample = await prisma.ship.findFirst({ where: { imo: { not: null } } });
      expect(sample?.imo).toBeTruthy();
      const imo = sample!.imo!;
      const res = await request(app)
        .get(`/api/v1/ships?q=${encodeURIComponent(imo)}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data[0].imo).toBe(imo);
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/ships");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/ships", () => {
    it("creates a user-added ship", async () => {
      const res = await request(app)
        .post("/api/v1/ships")
        .set("Cookie", authCookie)
        .send({ name: "MS Test", cruiseLine: "Test Line" });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      expect(res.body.data.name).toBe("MS Test");
      expect(res.body.data.cruiseLine).toBe("Test Line");
    });

    it("rejects empty name", async () => {
      const res = await request(app)
        .post("/api/v1/ships")
        .set("Cookie", authCookie)
        .send({ name: "", cruiseLine: "Test Line" });
      expect(res.status).toBe(400);
    });

    it("rejects missing cruiseLine", async () => {
      const res = await request(app)
        .post("/api/v1/ships")
        .set("Cookie", authCookie)
        .send({ name: "Nameless" });
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post("/api/v1/ships")
        .send({ name: "MS Test", cruiseLine: "Test Line" });
      expect(res.status).toBe(401);
    });
  });
});

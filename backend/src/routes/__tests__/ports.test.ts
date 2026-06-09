import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Ports API", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "porttest" } });
    const user = await prisma.user.create({
      data: { username: "porttest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.port.deleteMany({ where: { isUserAdded: true } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/ports", () => {
    it("returns all ports when no query", async () => {
      const res = await request(app).get("/api/v1/ports").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(50);
    });

    it("filters by q (case-insensitive substring)", async () => {
      const res = await request(app).get("/api/v1/ports?q=bar").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.some((p: { name: string }) => p.name === "Barcelona")).toBe(true);
    });

    it("exact UNLOCODE match ranks first", async () => {
      const res = await request(app).get("/api/v1/ports?q=DEHAM").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data[0].unlocode).toBe("DEHAM");
    });

    it("filters by region", async () => {
      const res = await request(app)
        .get("/api/v1/ports?region=mediterranean")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((p: { region: string }) => p.region === "mediterranean")).toBe(
        true
      );
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/ports");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/ports", () => {
    it("creates a user-added port", async () => {
      const res = await request(app)
        .post("/api/v1/ports")
        .set("Cookie", authCookie)
        .send({
          name: "Kleiner Hafen",
          city: "Timmendorf",
          country: "Germany",
          lat: 54.0,
          lon: 10.8,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      expect(res.body.data.name).toBe("Kleiner Hafen");
    });

    it("rejects invalid coordinates", async () => {
      const res = await request(app)
        .post("/api/v1/ports")
        .set("Cookie", authCookie)
        .send({ name: "X", lat: 999, lon: 0 });
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post("/api/v1/ports")
        .send({ name: "Y", lat: 0, lon: 0 });
      expect(res.status).toBe(401);
    });
  });
});

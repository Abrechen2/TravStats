import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { geocodePort } from "../../services/portGeocoder";

// The geocode route proxies OpenStreetMap Nominatim — mocked here so the
// suite never talks to the internet (and never trips the 1 req/s policy).
jest.mock("../../services/portGeocoder", () => ({
  geocodePort: jest.fn(),
}));

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

  // The resolution chain the roadmap's "Taranto" item complained about,
  // pinned end to end: diacritic-insensitive search, exonym expansion, and
  // the external geocoder fallback route (Nominatim mocked).
  describe("port resolution chain", () => {
    it("search is diacritic-insensitive (Malaga finds Málaga)", async () => {
      const res = await request(app).get("/api/v1/ports?q=Malaga").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.some((p: { name: string }) => p.name === "Málaga")).toBe(true);
    });

    it("search expands German exonyms (Lissabon finds Lisbon)", async () => {
      const res = await request(app).get("/api/v1/ports?q=Lissabon").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.some((p: { name: string }) => p.name === "Lisbon")).toBe(true);
    });

    it("Taranto resolves from the local catalog (the original complaint)", async () => {
      const res = await request(app).get("/api/v1/ports?q=Taranto").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(
        res.body.data.some((p: { unlocode: string | null }) => p.unlocode === "ITTAR")
      ).toBe(true);
    });
  });

  describe("GET /api/v1/ports/geocode", () => {
    beforeEach(() => {
      jest.mocked(geocodePort).mockReset();
    });

    it("returns geocoder candidates for a name the catalog does not carry", async () => {
      jest.mocked(geocodePort).mockResolvedValue([
        {
          name: "Portoferraio",
          city: "Portoferraio",
          country: "Italia",
          lat: 42.81,
          lon: 10.31,
          source: "geocoder",
        },
      ]);
      const res = await request(app)
        .get("/api/v1/ports/geocode?q=Portoferraio")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].source).toBe("geocoder");
      expect(geocodePort).toHaveBeenCalledWith("Portoferraio");
    });

    it("returns an empty list for a sub-2-char query without calling the geocoder", async () => {
      const res = await request(app).get("/api/v1/ports/geocode?q=a").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(geocodePort).not.toHaveBeenCalled();
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/ports/geocode?q=Portoferraio");
      expect(res.status).toBe(401);
    });
  });
});

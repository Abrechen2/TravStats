jest.mock("../../services/geo/photon", () => ({
  searchPlaces: jest.fn(),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { searchPlaces } from "../../services/geo/photon";

const mockSearchPlaces = searchPlaces as jest.Mock;

describe("Geo API", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "geotest" } });
    const user = await prisma.user.create({
      data: {
        username: "geotest",
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockSearchPlaces.mockReset();
  });

  describe("GET /api/v1/geo/search", () => {
    it("returns the normalized envelope on a happy path", async () => {
      mockSearchPlaces.mockResolvedValue([
        {
          name: "Zürich",
          address: "Bahnhofstrasse 1",
          city: "Zürich",
          country: "Switzerland",
          countryCode: "CH",
          lat: 47.3769,
          lon: 8.5417,
          type: "city",
        },
      ]);

      const res = await request(app)
        .get("/api/v1/geo/search?q=Zurich")
        .set("Cookie", authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        {
          name: "Zürich",
          address: "Bahnhofstrasse 1",
          city: "Zürich",
          country: "Switzerland",
          countryCode: "CH",
          lat: 47.3769,
          lon: 8.5417,
          type: "city",
        },
      ]);
      expect(mockSearchPlaces).toHaveBeenCalledWith("Zurich", {
        lang: undefined,
      });
    });

    it("forwards lang to the service", async () => {
      mockSearchPlaces.mockResolvedValue([]);
      await request(app)
        .get("/api/v1/geo/search?q=Berlin&lang=de")
        .set("Cookie", authCookie);
      expect(mockSearchPlaces).toHaveBeenCalledWith("Berlin", { lang: "de" });
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/geo/search?q=Berlin");
      expect(res.status).toBe(401);
      expect(mockSearchPlaces).not.toHaveBeenCalled();
    });

    it("rejects a query shorter than 2 characters (400, not a service call)", async () => {
      const res = await request(app)
        .get("/api/v1/geo/search?q=a")
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
      expect(mockSearchPlaces).not.toHaveBeenCalled();
    });

    it("rejects a missing q", async () => {
      const res = await request(app)
        .get("/api/v1/geo/search")
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
    });

    it("rejects a lang that isn't exactly 2 characters", async () => {
      const res = await request(app)
        .get("/api/v1/geo/search?q=Berlin&lang=deu")
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
      expect(mockSearchPlaces).not.toHaveBeenCalled();
    });

    it("never surfaces a 5xx to the client when the geocoder is down — the service degrades to []", async () => {
      mockSearchPlaces.mockResolvedValue([]);
      const res = await request(app)
        .get("/api/v1/geo/search?q=Berlin")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("applies the photonSearchLimiter (rate-limit headers present)", async () => {
      mockSearchPlaces.mockResolvedValue([]);
      const res = await request(app)
        .get("/api/v1/geo/search?q=Berlin")
        .set("Cookie", authCookie);
      expect(res.headers["ratelimit-limit"]).toBeDefined();
    });
  });
});

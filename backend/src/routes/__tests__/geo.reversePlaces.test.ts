jest.mock("../../services/geo/photon", () => ({
  searchPlacesDetailed: jest.fn(),
  reversePlacesDetailed: jest.fn(),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { reversePlacesDetailed } from "../../services/geo/photon";

const mockReversePlaces = reversePlacesDetailed as jest.Mock;

/**
 * GET /geo/reverse-places — the nearest named places around a pin, for the
 * map-pick modal's POI selection. Same envelope contract as /geo/search:
 * `degraded: true` = the geocoder itself failed (still HTTP 200).
 */
describe("GET /api/v1/geo/reverse-places", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "georevplacestest" } });
    const user = await prisma.user.create({
      data: {
        username: "georevplacestest",
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
    mockReversePlaces.mockReset();
  });

  it("returns the nearby places with the degraded flag", async () => {
    mockReversePlaces.mockResolvedValue({
      results: [
        {
          name: "Hotel Adlon Kempinski",
          address: "Unter den Linden 77",
          city: "Berlin",
          country: "Deutschland",
          countryCode: "DE",
          lat: 52.5163,
          lon: 13.3803,
          type: "hotel",
        },
      ],
      degraded: false,
    });

    const res = await request(app)
      .get("/api/v1/geo/reverse-places?lat=52.516&lon=13.38&lang=de")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.degraded).toBe(false);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Hotel Adlon Kempinski");
    expect(mockReversePlaces).toHaveBeenCalledWith(52.516, 13.38, { lang: "de", limit: 5 });
  });

  it("surfaces a geocoder failure as degraded, still HTTP 200", async () => {
    mockReversePlaces.mockResolvedValue({ results: [], degraded: true });

    const res = await request(app)
      .get("/api/v1/geo/reverse-places?lat=0&lon=0")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const res = await request(app)
      .get("/api/v1/geo/reverse-places?lat=91&lon=0")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
    expect(mockReversePlaces).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/geo/reverse-places?lat=52&lon=13");
    expect(res.status).toBe(401);
  });
});

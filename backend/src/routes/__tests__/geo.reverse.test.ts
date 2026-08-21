jest.mock("../../services/geo/nominatim", () => ({
  reverseGeocode: jest.fn(),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { reverseGeocode } from "../../services/geo/nominatim";

const mockReverse = reverseGeocode as jest.Mock;

/**
 * GET /geo/reverse — coordinates → address parts, for the map-pick modal
 * (owner request 2026-08-21: a picked pin should be able to COMPLETE the
 * address, on every surface, not just the lodging save path). Same
 * same-origin-proxy rationale as /geo/search: the CSP forbids the browser
 * talking to Nominatim directly.
 */
describe("GET /api/v1/geo/reverse", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "georeversetest" } });
    const user = await prisma.user.create({
      data: {
        username: "georeversetest",
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
    mockReverse.mockReset();
  });

  it("returns the resolved address parts", async () => {
    mockReverse.mockResolvedValue({
      name: "Hotel Adlon Kempinski",
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
    });

    const res = await request(app)
      .get("/api/v1/geo/reverse?lat=52.516&lon=13.38")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      name: "Hotel Adlon Kempinski",
      address: "Unter den Linden 77",
      city: "Berlin",
      country: "Deutschland",
    });
    expect(mockReverse).toHaveBeenCalledWith(52.516, 13.38);
  });

  it("answers 200 with data:null when nothing resolves — an empty sea pin is not an error", async () => {
    mockReverse.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/v1/geo/reverse?lat=0&lon=0")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const res = await request(app)
      .get("/api/v1/geo/reverse?lat=91&lon=0")
      .set("Cookie", authCookie);

    expect(res.status).toBe(400);
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it("rejects missing parameters with 400", async () => {
    const res = await request(app).get("/api/v1/geo/reverse").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/geo/reverse?lat=52&lon=13");
    expect(res.status).toBe(401);
  });
});

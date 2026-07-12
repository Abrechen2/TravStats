import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as service from "../../services/airlineLogo/airlineLogoService";

describe("GET /api/v1/airline-logos/:code", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "airlinelogotest" } });
    const user = await prisma.user.create({
      data: { username: "airlinelogotest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("401 without auth", async () => {
    const res = await request(app).get("/api/v1/airline-logos/LH");
    expect(res.status).toBe(401);
  });

  it("400 for an invalid code", async () => {
    const res = await request(app).get("/api/v1/airline-logos/TOOLONG1").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("400 for an unknown variant", async () => {
    const res = await request(app)
      .get("/api/v1/airline-logos/LH?variant=hologram")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("200 with image bytes and immutable caching on a hit", async () => {
    jest.spyOn(service, "resolveAirlineLogo").mockResolvedValue({
      body: Buffer.from("<svg/>"),
      contentType: "image/svg+xml",
    });
    const res = await request(app).get("/api/v1/airline-logos/lh").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["cache-control"]).toContain("max-age=604800");
    expect(service.resolveAirlineLogo).toHaveBeenCalledWith("LH", "icon"); // uppercased + default variant
  });

  it("404 on a miss", async () => {
    jest.spyOn(service, "resolveAirlineLogo").mockResolvedValue(null);
    const res = await request(app).get("/api/v1/airline-logos/ZZ").set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });
});

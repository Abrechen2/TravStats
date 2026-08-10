import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("GET /api/v1/stats/punctuality", () => {
  let cookie: string;
  let userId: string;

  const mk = (delayMinutes: number | null, over: Record<string, unknown> = {}) => ({
    userId,
    depIata: "MUC",
    arrIata: "JFK",
    depLat: 48.35,
    depLon: 11.78,
    arrLat: 40.64,
    arrLon: -73.78,
    airlineIata: "LH",
    status: "flown",
    departureTime: new Date("2026-01-10T08:00:00Z"),
    delayMinutes,
    ...over,
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "punctualityUser" } });
    const user = await prisma.user.create({
      data: { username: "punctualityUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "punctualityUser" } });
  });

  it("returns an empty shape when no flight carries a delay", async () => {
    await prisma.flight.create({ data: mk(null) });
    const res = await request(app).get("/api/v1/stats/punctuality").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(0);
    expect(res.body.worstAirline).toBeNull();
  });

  it("aggregates delays into avg, on-time rate and worst airline", async () => {
    await prisma.flight.createMany({
      data: [
        mk(5, { airlineIata: "LH" }),
        mk(10, { airlineIata: "LH" }),
        mk(8, { airlineIata: "LH" }),
        mk(50, { airlineIata: "BA" }),
        mk(60, { airlineIata: "BA" }),
        mk(70, { airlineIata: "BA" }),
      ],
    });
    const res = await request(app).get("/api/v1/stats/punctuality").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBe(6);
    expect(res.body.bestAirline.key).toBe("LH");
    expect(res.body.worstAirline.key).toBe("BA");
    expect(res.body.avgDelayMinutes).toBeGreaterThan(0);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/v1/stats/punctuality")).status).toBe(401);
  });
});

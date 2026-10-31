import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** forgejo#338: the map and an opt-in list leave the two heavy JSON columns in the database. */
describe("flight rows without the heavy JSON", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `flights-lean-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.flight.create({
      data: {
        userId,
        depIata: "MUC",
        depLat: 48.35,
        depLon: 11.78,
        arrIata: "CPH",
        arrLat: 55.61,
        arrLon: 12.65,
        status: "flown",
        departureTime: new Date("2024-05-01T08:00:00Z"),
        actualRoute: [{ lat: 50, lon: 10, timestamp: 1 }],
        enrichmentHistory: [{ type: "route", timestamp: 1 }],
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("GET /flights keeps the full row by default and drops the JSON with lean=1", async () => {
    const full = await request(app).get("/api/v1/flights").set("Cookie", cookie);
    expect(full.body.flights[0].actualRoute).toHaveLength(1);
    expect(full.body.flights[0].enrichmentHistory).toHaveLength(1);
    const lean = await request(app).get("/api/v1/flights?lean=1").set("Cookie", cookie);
    expect(lean.body.total).toBe(1);
    expect(lean.body.flights[0].depIata).toBe("MUC");
    expect(lean.body.flights[0]).not.toHaveProperty("actualRoute");
    expect(lean.body.flights[0]).not.toHaveProperty("enrichmentHistory");
  });

  it("GET /flights/geo reads the flights without the heavy JSON and answers the same feature", async () => {
    const spy = jest.spyOn(prisma.flight, "findMany");
    try {
      const res = await request(app).get("/api/v1/flights/geo").set("Cookie", cookie);
      expect(res.body.features).toHaveLength(1);
      expect(res.body.features[0].properties.departureAirport.iata).toBe("MUC");
      const args = spy.mock.calls[0][0] as { omit?: Record<string, boolean> };
      expect(args.omit).toEqual({ actualRoute: true, enrichmentHistory: true });
    } finally {
      spy.mockRestore();
    }
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    flight: {
      findMany: mockFindMany,
    },
  },
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));
jest.mock("../middleware/rateLimit", () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from "supertest";
import express from "express";
import { aircraftRankingResponseSchema } from "../schemas/statsAircraft";

describe("GET /api/v1/stats/aircraft", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    mockFindMany.mockReset();
    const { default: statsRoutes } = await import("./stats");
    app = express();
    app.use(express.json());
    app.use("/api/v1/stats", statsRoutes);
  });

  // A cancelled flight never happened, so it must not add its distance to a
  // hull's lifetime total — the same status scope the rest of /stats uses.
  it("counts only flown and historical flights", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/stats/aircraft");
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["flown", "historical"] } }),
      })
    );
  });

  /**
   * The route infers its TYPES from `schemas/statsAircraft`, which tsc checks —
   * but a type is not a value. This parses what actually went over the wire, so
   * the spec published to clients is held against the bytes rather than against
   * a compile-time promise (forgejo#52).
   */
  it("answers a body the published schema accepts", async () => {
    mockFindMany.mockResolvedValue([
      {
        aircraftRegistration: "D-AIZP",
        airline: "Lufthansa",
        aircraft: "Airbus A320neo",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date("2026-05-01T06:00:00.000Z"),
        status: "flown",
      },
    ]);

    const res = await request(app).get("/api/v1/stats/aircraft");

    const parsed = aircraftRankingResponseSchema.safeParse(res.body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(res.body.aircraft).toHaveLength(1);
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * When a stats calculator throws, five endpoints used to answer 200 with a
 * hand-written object of zeros, while /stats/page (same functions) answered
 * 5xx. "Abstention is a result": the user must see a failure, not confident
 * zeros (forgejo#368).
 */
const boom = () => {
  throw new Error("calculator exploded");
};

jest.mock("../../utils/statsCalculator", () => ({
  ...(jest.requireActual("../../utils/statsCalculator") as object),
  calculateFunStats: boom,
  calculateBusinessStats: boom,
  calculateUniqueStats: boom,
}));
jest.mock("../../utils/cruiseStats", () => ({
  ...(jest.requireActual("../../utils/cruiseStats") as object),
  calculateCruiseStats: boom,
}));
jest.mock("../../utils/lodgingStats", () => ({
  ...(jest.requireActual("../../utils/lodgingStats") as object),
  calculateLodgingStats: boom,
}));
jest.mock("../../services/stats/departureClock", () => ({
  ...(jest.requireActual("../../services/stats/departureClock") as object),
  withDepartureClock: async (f: unknown) => f,
}));

const empty = jest.fn(async () => [] as unknown[]);
jest.mock("../../db", () => ({
  prisma: {
    flight: { findMany: empty },
    cruise: { findMany: empty },
    lodgingStay: { findMany: empty },
    lodging: { findMany: empty },
    user: { findUnique: jest.fn(async () => ({ birthdate: null })) },
    userSettings: { findUnique: jest.fn(async () => ({ baseCurrency: "EUR" })) },
    loyaltyMembership: { findMany: empty },
    homePeriod: { findMany: empty },
  },
}));
jest.mock("../../middleware/auth", () => ({
  authenticate: (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = "u1";
    next();
  },
  AuthRequest: {},
}));
jest.mock("../../middleware/rateLimit", () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from "supertest";
import express from "express";

describe("a failing stats calculator is a 5xx, not a page of zeros", () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import("../stats");
    app = express();
    app.use(express.json());
    app.use("/api/v1/stats", statsRoutes);
    app.use(
      (_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: "internal" });
      }
    );
  });

  it.each(["fun", "business", "unique", "cruise", "lodging"])(
    "GET /stats/%s answers 500 when the calculator throws",
    async (path) => {
      await request(app).get(`/api/v1/stats/${path}`).expect(500);
    }
  );
});

/**
 * /pending-updates carries MUTATING routes (apply writes onto the flight,
 * PUT edits, DELETE removes) — a read-scoped PAT must not reach them.
 * Found in the Companion's live-inbox review: the router mounted only
 * `authenticate`, unlike every other mutating router.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  securityLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock("../db", () => ({ prisma: { pendingUpdateStatistics: { findUnique: jest.fn() } } }));
jest.mock("../utils/jwtSecret", () => ({ JWT_SECRET: "test-secret" }));

jest.mock("../services/pendingUpdateService", () => ({
  getPendingUpdates: jest.fn(async () => []),
  getPendingUpdateById: jest.fn(async () => null),
  applyPendingUpdate: jest.fn(),
  rejectPendingUpdate: jest.fn(),
  updatePendingUpdate: jest.fn(),
  previewStatisticsImpact: jest.fn(),
}));

// authenticate is mocked to inject the PAT under test; requireWriteScope
// stays REAL — that is the guard this suite pins.
let mockScope: "read" | "write" = "read";
jest.mock("../middleware/auth", () => {
  const actual = jest.requireActual<typeof import("../middleware/auth")>(
    "../middleware/auth",
  );
  return {
    ...actual,
    authenticate: (req: unknown, _res: unknown, next: () => void) => {
      const r = req as express.Request & {
        userId?: string;
        apiToken?: { id: string; scope: string };
      };
      r.userId = "u1";
      r.apiToken = { id: "tok-1", scope: mockScope };
      next();
    },
  };
});

import pendingUpdatesRouter from "../routes/pendingUpdates";
import { errorHandler } from "../middleware/errorHandler";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pending-updates", pendingUpdatesRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("pending-updates write scope", () => {
  it("rejects apply for a read-scoped PAT with 403", async () => {
    mockScope = "read";
    const res = await request(makeApp()).post("/api/v1/pending-updates/pu-1/apply");
    expect(res.status).toBe(403);
  });

  it("rejects reject/PUT/DELETE for a read-scoped PAT", async () => {
    mockScope = "read";
    const app = makeApp();
    expect((await request(app).post("/api/v1/pending-updates/pu-1/reject")).status).toBe(403);
    expect((await request(app).put("/api/v1/pending-updates/pu-1")).status).toBe(403);
    expect((await request(app).delete("/api/v1/pending-updates/pu-1")).status).toBe(403);
  });

  it("keeps read access for a read-scoped PAT", async () => {
    mockScope = "read";
    const res = await request(makeApp()).get("/api/v1/pending-updates");
    expect(res.status).toBe(200);
  });

  it("lets a write-scoped PAT through to the handler", async () => {
    mockScope = "write";
    // The mocked service returns null → 404 proves the request PASSED the
    // scope gate and reached the handler.
    const res = await request(makeApp()).post("/api/v1/pending-updates/pu-1/apply");
    expect(res.status).toBe(404);
  });
});

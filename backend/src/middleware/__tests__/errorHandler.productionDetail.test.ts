import express from "express";
import request from "supertest";

import { AppError, errorHandler } from "../errorHandler";

jest.mock("../../services/loggingConfig", () => ({
  isDebugEnabled: jest.fn(async () => false),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/** forgejo#412 M2 — an unexpected 500 must not echo its message in production. */
function appThrowing(err: Error) {
  const a = express();
  a.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = "req-123";
    next();
  });
  a.get("/x", (_req, _res, next) => next(err));
  a.use(errorHandler as unknown as express.ErrorRequestHandler);
  return a;
}

describe("unexpected 500s in production", () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it("hide the message and carry the request id", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(appThrowing(new Error('relation "users" does not exist'))).get("/x");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.requestId).toBe("req-123");
    expect(JSON.stringify(res.body)).not.toContain("relation");
  });

  it("still show an AppError's own message", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(appThrowing(new AppError("Provider down", 500))).get("/x");
    expect(res.body.error).toBe("Provider down");
  });

  it("keep the message outside production", async () => {
    process.env.NODE_ENV = "test";
    const res = await request(appThrowing(new Error("boom"))).get("/x");
    expect(res.body.error).toBe("boom");
  });
});

/**
 * forgejo#439: pending place suggestions are re-judged after every write that
 * can cover one — a place visit, a lodging stay, a flight, a trip's dates —
 * not only at the next scan.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const queueSuggestionReconcile = jest.fn<(userId: string) => Promise<void>>();
jest.mock("../../services/suggestions/reconcile", () => ({
  queueSuggestionReconcile: (userId: string) => queueSuggestionReconcile(userId),
}));

import afterWriteRouter from "../suggestionsAfterWrite";

function makeApp(status: number): express.Express {
  const app = express();
  app.use("/api/v1", afterWriteRouter);
  app.use("/api/v1", (req, res) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    res.status(status).json({});
  });
  return app;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  queueSuggestionReconcile.mockReset();
  queueSuggestionReconcile.mockResolvedValue(undefined);
});

describe("suggestion reconcile after a write (forgejo#439)", () => {
  it.each([
    ["post", "/api/v1/places/p1/visits"],
    ["patch", "/api/v1/places/visits/v1"],
    ["delete", "/api/v1/places/visits/v1"],
    ["post", "/api/v1/lodging/l1/stays"],
    ["put", "/api/v1/flights/f1"],
    ["patch", "/api/v1/trips/t1"],
  ] as const)("queues a run after %s %s", async (method, path) => {
    await request(makeApp(200))[method](path).send({});
    await settle();
    expect(queueSuggestionReconcile).toHaveBeenCalledWith("u1");
  });

  it("does nothing for a refused write, a read, or another path", async () => {
    await request(makeApp(400)).post("/api/v1/places/p1/visits").send({});
    await request(makeApp(200)).get("/api/v1/places");
    await request(makeApp(200)).post("/api/v1/rail").send({});
    await settle();
    expect(queueSuggestionReconcile).not.toHaveBeenCalled();
  });
});

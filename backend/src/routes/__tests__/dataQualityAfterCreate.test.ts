/**
 * The inbox checks run after a create (spec 2026-10-25 C3), not only at the
 * nightly sweep — and a burst of creates costs one queued run, not one each.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const runDataQualityChecks = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/dataQuality", () => ({
  runDataQualityChecks: (userId: string) => runDataQualityChecks(userId),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import afterCreateRouter from "../dataQualityAfterCreate";

function makeApp(status: number): express.Express {
  const app = express();
  app.use("/api/v1", afterCreateRouter);
  // Stands in for a domain router: authenticates, then answers.
  app.use("/api/v1", (req, res) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    res.status(status).json({});
  });
  return app;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  runDataQualityChecks.mockReset();
  runDataQualityChecks.mockResolvedValue({});
});

describe("data-quality checks after a create", () => {
  it("queues a run for the account once a flight is created", async () => {
    await request(makeApp(201)).post("/api/v1/flights").send({});
    await settle();
    expect(runDataQualityChecks).toHaveBeenCalledWith("u1");
  });

  it("covers a stay created on its lodging", async () => {
    await request(makeApp(201)).post("/api/v1/lodging/l1/stays").send({});
    await settle();
    expect(runDataQualityChecks).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a refused create, a read, or another path", async () => {
    await request(makeApp(400)).post("/api/v1/flights").send({});
    await request(makeApp(200)).get("/api/v1/flights");
    await request(makeApp(200)).post("/api/v1/flights/refresh-historical-bulk").send({});
    await settle();
    expect(runDataQualityChecks).not.toHaveBeenCalled();
  });

  it("coalesces a burst of creates into the run already queued", async () => {
    let release: () => void = () => undefined;
    runDataQualityChecks.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({})))
    );
    const app = makeApp(201);
    await request(app).post("/api/v1/flights").send({}); // starts run 1
    await settle();
    for (let i = 0; i < 5; i += 1) await request(app).post("/api/v1/rail").send({});
    release();
    await settle();
    await settle();
    // Run 1, plus ONE queued behind it for the five rides.
    expect(runDataQualityChecks).toHaveBeenCalledTimes(2);
  });
});

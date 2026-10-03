import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

import { pdfParseLimiter, railCreationLimiter } from "../rateLimit";

/**
 * A first import is not abuse. On 2026-10-03 a tester entering years of rail
 * tickets was answered 429 after exactly 20 journeys, for the rest of the
 * hour, and restarted the container to carry on — twice. Both limiters on
 * that path (one parse per PDF, one save per leg) stopped at 20.
 */
function appBehind(limiter: express.RequestHandler): express.Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: string }).userId = "first-import-user";
    next();
  });
  app.post("/", limiter, (_req, res) => {
    res.status(201).end();
  });
  return app;
}

async function statusesOf(app: express.Express, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await request(app).post("/")).status);
  return statuses;
}

describe("a first import fits inside the limiters on its path", () => {
  it("saves fifty rail journeys in a row", async () => {
    const statuses = await statusesOf(appBehind(railCreationLimiter), 50);
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  });

  it("parses fifty PDFs in a row", async () => {
    const statuses = await statusesOf(appBehind(pdfParseLimiter), 50);
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  });

  it("still stops a runaway client", async () => {
    const statuses = await statusesOf(appBehind(pdfParseLimiter), 30);
    // 50 + 30 on the same bucket: the window's 60 are spent.
    expect(statuses.filter((s) => s === 429).length).toBe(20);
  });
});

import express from "express";
import request from "supertest";

import { stationAppendLimiter } from "../rateLimit";

/**
 * The phone's station append reverse-geocodes through a queue every user
 * shares, so one looping client must not be able to stall it: the twenty-
 * first append in a minute is refused, per user — another account is not.
 */
describe("stationAppendLimiter", () => {
  function app(): express.Express {
    const a = express();
    a.use((req, _res, next) => {
      (req as unknown as { userId: string }).userId = String(req.headers["x-user"]);
      next();
    });
    a.post("/append", stationAppendLimiter, (_req, res) => {
      res.status(201).end();
    });
    return a;
  }

  it("refuses the twenty-first append in a minute from one user, not from another", async () => {
    const server = app();
    for (let i = 0; i < 20; i++) {
      expect((await request(server).post("/append").set("x-user", "loop")).status).toBe(201);
    }
    expect((await request(server).post("/append").set("x-user", "loop")).status).toBe(429);
    expect((await request(server).post("/append").set("x-user", "someone-else")).status).toBe(201);
  });
});

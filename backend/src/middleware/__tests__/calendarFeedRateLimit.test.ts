import express from "express";
import request from "supertest";

import { prisma } from "../../db";
import { errorHandler } from "../errorHandler";
import calendarFeedPublicRoutes from "../../routes/calendarFeedPublic";

/**
 * The calendar feed's scraping bound (forgejo#310): an address that walks
 * through URLs that do not resolve is stopped after 30 a minute with a 429 —
 * which says "slow down" and nothing about whether any of them existed.
 *
 * A slim app with `trust proxy: loopback`, so each test can be its own address.
 */
function feedApp(): express.Express {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use("/api/v1/calendar", calendarFeedPublicRoutes);
  app.use(errorHandler);
  return app;
}

const unknownFeed = (n: number): string =>
  `/api/v1/calendar/ts_cal_${String(n).padStart(43, "A")}.ics`;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("calendar feed rate limit", () => {
  it("answers 429 after 30 unknown feeds a minute from one address", async () => {
    const app = feedApp();
    for (let i = 0; i < 30; i++) {
      const res = await request(app).get(unknownFeed(i)).set("X-Forwarded-For", "203.0.113.7");
      expect(res.status).toBe(404);
    }
    const limited = await request(app).get(unknownFeed(31)).set("X-Forwarded-For", "203.0.113.7");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");

    // Another address is not punished for it.
    const other = await request(app).get(unknownFeed(32)).set("X-Forwarded-For", "198.51.100.9");
    expect(other.status).toBe(404);
  });
});

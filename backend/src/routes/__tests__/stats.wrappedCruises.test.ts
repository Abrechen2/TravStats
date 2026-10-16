import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Since migration 20261010010000_cruise_status_completed a sailed cruise is
 * `completed`. The year in review loaded cruises with the FLIGHT rule
 * (flown/historical) and so told every such year with zero cruises.
 */
describe("GET /api/v1/stats/wrapped — sailed cruises", () => {
  const username = "wrapped-cruises-completed";
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "cruise"], data: {} },
    });
    await prisma.cruise.createMany({
      data: [
        { userId, startDate: new Date("2024-05-10"), status: "completed" },
        { userId, startDate: new Date("2024-08-01"), status: "planned" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
  });

  it("counts a `completed` cruise and not a planned one", async () => {
    const res = await request(app).get("/api/v1/stats/wrapped?year=2024").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: 2024, cruises: 1 });
  });
});

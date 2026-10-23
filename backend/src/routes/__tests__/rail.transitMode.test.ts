import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * A U-Bahn or tram ride kept from a bahn.de import is a rail journey with its
 * real mode (2026-10-23): written and edited through POST/PATCH /rail, `rail`
 * when nobody says otherwise, and listed beside the trains.
 */
const RATHAUS = { name: "Marienplatz", lat: 48.137154, lon: 11.576124, country: "DE" };
const ODEON = { name: "Odeonsplatz", lat: 48.142583, lon: 11.577571, country: "DE" };

describe("rail journeys carry their transit mode", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const ride = (extra: Record<string, unknown> = {}) => ({
    trainCategory: "U",
    trainNumber: "3",
    departureStation: RATHAUS,
    arrivalStation: ODEON,
    departureLocal: "2025-03-05T08:00",
    arrivalLocal: "2025-03-05T08:04",
    ...extra,
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `rail-mode-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "rail"], data: {} },
    });
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is a train unless the write says otherwise", async () => {
    const res = await request(app).post("/api/v1/rail").set("Cookie", cookie).send(ride());
    expect(res.status).toBe(201);
    expect(res.body.data.transitMode).toBe("rail");
  });

  it("stores a metro ride as metro, lists it, and lets the form change it", async () => {
    const created = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send(ride({ transitMode: "metro" }));
    expect(created.status).toBe(201);
    expect(created.body.data.transitMode).toBe("metro");

    const list = await request(app).get("/api/v1/rail").set("Cookie", cookie);
    expect(list.body.data.map((j: { transitMode: string }) => j.transitMode)).toEqual(["metro"]);

    const patched = await request(app)
      .patch(`/api/v1/rail/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ transitMode: "tram" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.transitMode).toBe("tram");
  });

  it("refuses a mode outside rail, metro and tram — a bus is a bus ride", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send(ride({ transitMode: "bus" }));
    expect(res.status).toBe(400);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });
});

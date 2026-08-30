import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Creating a flight from a local wall-clock time without naming the timezone.
 *
 * The server needs a zone to turn "2007-07-26T08:25" into an instant, and it
 * used to demand one from the caller — including when the caller had already
 * said which airport the flight left from, which is the one fact the zone can
 * be read off. Someone bulk-importing an old mailbox hit a validation error on
 * every request for a value the server had on file all along (#286).
 *
 * The rule that a local time needs SOME zone is unchanged and still enforced
 * below; what changed is that a known airport now answers it.
 */
describe("POST /api/v1/flights — timezone from the airport", () => {
  let user: { id: string };
  let authCookie: string;
  let catalogReady = false;

  beforeAll(async () => {
    const muc = await prisma.airport.findFirst({ where: { iata: "MUC" } });
    catalogReady = Boolean(muc?.timezone);
    if (!catalogReady) return;

    user = await prisma.user.create({
      data: {
        username: `flight-tz-from-airport-${Date.now()}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("accepts a local time without a timezone when the airport is known", async () => {
    if (!catalogReady) return;
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        departure: { iata: "MUC", lat: 48.35, lon: 11.79 },
        arrival: { iata: "CGN", lat: 50.87, lon: 7.14 },
        departureLocal: "2007-07-26T08:25",
        arrivalLocal: "2007-07-26T09:30",
        status: "flown",
      });

    expect(res.status).toBe(201);

    // 08:25 in Munich on that date is 06:25 UTC. Reading it as UTC — the
    // failure this guards — would store 08:25Z and shift the flight two hours.
    expect(new Date(res.body.flight.departureTime).toISOString()).toBe(
      "2007-07-26T06:25:00.000Z",
    );
    expect(res.body.flight.depTimeSemantics).toBe("UTC");
  });

  it("still refuses a local time when no airport can answer the zone", async () => {
    if (!catalogReady) return;
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        departure: { lat: 48.35, lon: 11.79 },
        arrival: { lat: 50.87, lon: 7.14 },
        departureLocal: "2007-07-26T08:25",
        status: "flown",
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("depTimezone");
  });
});

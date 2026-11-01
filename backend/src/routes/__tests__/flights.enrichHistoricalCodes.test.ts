import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#397: the web caller for "enrich this flight" tells its failures apart
 * by a stable code, because the prose is English and the UI is German.
 */
describe("POST /api/v1/flights/:id/enrich-historical — stable failure codes", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let withNumber: string;
  let withoutNumber: string;

  const post = (id: string) =>
    request(app).post(`/api/v1/flights/${id}/enrich-historical`).set("Cookie", cookie);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `enrich-codes-${stamp}`,
        passwordHash: await hashPassword("test-password"),
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, historicalEnrichmentEnabled: false },
      update: { historicalEnrichmentEnabled: false },
    });
    withNumber = (
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: "ZZ9999",
          depIata: "MUC",
          depLat: 48.35,
          depLon: 11.78,
          arrIata: "JFK",
          arrLat: 40.64,
          arrLon: -73.78,
          status: "flown",
        },
      })
    ).id;
    withoutNumber = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "MUC",
          depLat: 48.35,
          depLon: 11.78,
          arrIata: "JFK",
          arrLat: 40.64,
          arrLon: -73.78,
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: "enrich-codes-" } } });
  });

  const setEnabled = (on: boolean) =>
    prisma.userSettings.update({ where: { userId }, data: { historicalEnrichmentEnabled: on } });

  it("answers ENRICH_DISABLED while the user's switch is off", async () => {
    const res = await post(withNumber);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ENRICH_DISABLED");
  });

  it("answers ENRICH_NO_FLIGHT_NUMBER for a flight without a number", async () => {
    await setEnabled(true);
    const res = await post(withoutNumber);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ENRICH_NO_FLIGHT_NUMBER");
  });

  it("answers ENRICH_NO_REFERENCE when no live-tracked reference flights exist", async () => {
    await setEnabled(true);
    const res = await post(withNumber);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ENRICH_NO_REFERENCE");
  });
});

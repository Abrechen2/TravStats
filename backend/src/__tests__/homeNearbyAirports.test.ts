import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

/**
 * "Zuhause" offers the airports near a residence as home airports. Against the
 * real catalogue: around Köln it used to offer Mönchengladbach (MGL, a
 * business field) and Geilenkirchen (GKE, a NATO air base) above Dortmund —
 * both carry an IATA code, neither has a scheduled flight. The offer must be
 * airports a traveller flies from, and must still keep any airport this user
 * has actually flown from.
 */

const KOELN = { lat: 50.9375, lon: 6.9603 };

describe("GET /settings/home-airports/nearby", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const nearby = async (): Promise<string[]> => {
    const res = await request(app)
      .get("/api/v1/settings/home-airports/nearby")
      .query(KOELN)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.airports.map((a: { code: string }) => a.code);
  };

  const flyFrom = async (code: string, status = "flown") => {
    const dep = await prisma.airport.findFirstOrThrow({ where: { iata: code, isClosed: false } });
    const arr = await prisma.airport.findFirstOrThrow({ where: { iata: "LHR", isClosed: false } });
    await prisma.flight.create({
      data: {
        userId,
        depIata: code,
        arrIata: "LHR",
        depLat: dep.lat,
        depLon: dep.lon,
        arrLat: arr.lat,
        arrLon: arr.lon,
        departureTime: new Date("2023-04-01T08:00:00Z"),
        status,
      },
    });
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `nearby-${stamp}`, passwordHash } });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    // The fixture is only meaningful while the catalogue carries both fields.
    const fields = await prisma.airport.findMany({
      where: { iata: { in: ["GKE", "MGL"] }, isClosed: false },
    });
    expect(fields).toHaveLength(2);
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("offers Köln/Bonn and Düsseldorf, not the air base or the business field", async () => {
    const codes = await nearby();
    expect(codes.slice(0, 2)).toEqual(["CGN", "DUS"]);
    expect(codes).not.toContain("GKE");
    expect(codes).not.toContain("MGL");
    // The freed places go to airports with scheduled flights.
    expect(codes).toContain("DTM");
  });

  it("keeps an airport without scheduled service this user has flown from", async () => {
    await flyFrom("GKE");
    const codes = await nearby();
    expect(codes).toContain("GKE");
    expect(codes).not.toContain("MGL");
  });

  it("does not count a cancelled flight as having flown from there", async () => {
    await flyFrom("MGL", "cancelled");
    expect(await nearby()).not.toContain("MGL");
  });
});

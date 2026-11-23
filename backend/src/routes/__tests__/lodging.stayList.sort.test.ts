import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /lodging/stays?sort=` — the stay list ordered by house, trip, status,
 * price, check-in or check-out, decided in SQL with a total tie-breaker so a
 * page boundary neither skips nor repeats a stay (CLAUDE.md: a bounded query
 * bounds the work, not the scan).
 */
describe("GET /api/v1/lodging/stays sort", () => {
  let userId: string;
  let cookie: string;
  const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
  const list = (query: Record<string, string>) =>
    request(app).get("/api/v1/lodging/stays").query(query).set("Cookie", cookie);
  const refs = (res: request.Response): string[] =>
    (res.body.data as Array<{ bookingReference: string }>).map((s) => s.bookingReference);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (
      await prisma.user.create({ data: { username: `stay-sort-${Date.now()}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    const zeta = await prisma.lodging.create({ data: { userId, name: "Zeta Inn", type: "hotel" } });
    const alpha = await prisma.lodging.create({
      data: { userId, name: "alpha Lodge", type: "hotel" },
    });
    const trip = await prisma.trip.create({ data: { userId, name: "Madrid" } });
    const base = { userId, datePrecision: "DAY" };
    await prisma.lodgingStay.createMany({
      data: [
        {
          ...base,
          lodgingId: zeta.id,
          bookingReference: "S1",
          checkIn: day("2025-01-01"),
          checkOut: day("2025-01-09"),
          status: "completed",
          totalPrice: 500,
        },
        {
          ...base,
          lodgingId: alpha.id,
          bookingReference: "S2",
          checkIn: day("2025-02-01"),
          checkOut: day("2025-02-03"),
          status: "cancelled",
          totalPrice: 90,
          tripId: trip.id,
        },
        {
          ...base,
          lodgingId: alpha.id,
          bookingReference: "S3",
          checkIn: day("2025-03-01"),
          checkOut: day("2025-03-02"),
          status: "completed",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("orders by house name case-insensitively, then check-in", async () => {
    expect(refs(await list({ sort: "house", order: "asc" }))).toEqual(["S2", "S3", "S1"]);
  });

  it("orders by price and sinks a stay without a price in both directions", async () => {
    expect(refs(await list({ sort: "price", order: "asc" }))).toEqual(["S2", "S1", "S3"]);
    expect(refs(await list({ sort: "price", order: "desc" }))).toEqual(["S1", "S2", "S3"]);
  });

  it("orders by trip with the trip-less stays last", async () => {
    expect(refs(await list({ sort: "trip", order: "asc" }))[0]).toBe("S2");
  });

  it("orders by check-out and by status", async () => {
    expect(refs(await list({ sort: "checkOut", order: "desc" }))).toEqual(["S3", "S2", "S1"]);
    expect(refs(await list({ sort: "status", order: "asc" }))[0]).toBe("S2");
  });

  it("pages a tied sort key without skipping or repeating a stay", async () => {
    const a = refs(await list({ sort: "status", order: "asc", limit: "2", offset: "0" }));
    const b = refs(await list({ sort: "status", order: "asc", limit: "2", offset: "2" }));
    expect([...a, ...b].sort()).toEqual(["S1", "S2", "S3"]);
  });

  it("refuses a sort key it does not offer", async () => {
    expect((await list({ sort: "rating" })).status).toBe(400);
  });
});

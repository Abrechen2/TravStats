import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A booking was readable only through its trip, so one with no trip could not
 * be listed at all, and the spreadsheet export had nothing to build a bookings
 * sheet from.
 */
describe("GET /trips/bookings lists the caller's bookings", () => {
  const stamp = Date.now();
  let ownerId: string;
  let strangerId: string;
  let emptyId: string;
  let tripId: string;
  let withTrip: string;
  let loose: string;
  let theirs: string;
  const cookie = (id: string): string => `auth_token=${generateToken(id)}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const mk = async (name: string): Promise<string> =>
      (await prisma.user.create({ data: { username: `bk-list-${name}-${stamp}`, passwordHash } }))
        .id;
    ownerId = await mk("owner");
    strangerId = await mk("stranger");
    emptyId = await mk("empty");
    tripId = (await prisma.trip.create({ data: { userId: ownerId, name: "Pack trip" } })).id;
    withTrip = (
      await prisma.booking.create({
        data: { userId: ownerId, tripId, pnr: "ABC123", price: 100, currency: "EUR" },
      })
    ).id;
    loose = (await prisma.booking.create({ data: { userId: ownerId, pnr: "LOOSE1" } })).id;
    theirs = (await prisma.booking.create({ data: { userId: strangerId, pnr: "THEIRS" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId, emptyId] } } });
  });

  it("returns trip-bound and trip-less bookings, never another account's", async () => {
    const res = await request(app).get("/api/v1/trips/bookings").set("Cookie", cookie(ownerId));

    expect(res.status).toBe(200);
    const rows = res.body.bookings as { id: string; tripId: string | null; pnr: string }[];
    expect(rows.map((b) => b.id).sort()).toEqual([withTrip, loose].sort());
    expect(rows.map((b) => b.id)).not.toContain(theirs);
    expect(rows.find((b) => b.id === withTrip)).toMatchObject({ tripId, pnr: "ABC123" });
    expect(rows.find((b) => b.id === loose)!.tripId).toBeNull();
    expect(res.body.total).toBe(2);
  });

  it("pages and keeps the total", async () => {
    const res = await request(app)
      .get("/api/v1/trips/bookings?limit=1&offset=0")
      .set("Cookie", cookie(ownerId));
    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it("answers an empty list for an account with no bookings", async () => {
    const res = await request(app).get("/api/v1/trips/bookings").set("Cookie", cookie(emptyId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookings: [], total: 0 });
  });
});

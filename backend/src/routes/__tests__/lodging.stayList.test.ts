import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /lodging/stays` - the chronological view across houses (forgejo#226) and
 * the candidate lookup behind the overlap notice (forgejo#229). Pinned: one
 * page in check-in order with the undated last, each row names its house and
 * trip, the window is a COARSE superset (adjacent days are returned - the exact
 * rule is the client's), and nothing of another account is ever listed.
 */
describe("GET /api/v1/lodging/stays", () => {
  let user: { id: string };
  let other: { id: string };
  let authCookie: string;
  let tripId: string;
  const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

  const list = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/lodging/stays").query(query).set("Cookie", authCookie);
  const ids = (res: request.Response): string[] =>
    (res.body.data as Array<{ bookingReference: string }>).map((s) => s.bookingReference);

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("stay-list");
    other = await make("stay-list-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    tripId = (await prisma.trip.create({ data: { userId: user.id, name: "Berlin 2025" } })).id;
    const adlon = await prisma.lodging.create({
      data: { userId: user.id, name: "Hotel Adlon", type: "hotel", city: "Berlin" },
    });
    const ibis = await prisma.lodging.create({
      data: { userId: user.id, name: "Ibis", type: "hotel", city: "Berlin" },
    });
    const foreign = await prisma.lodging.create({
      data: { userId: other.id, name: "Fremdes Haus", type: "hotel" },
    });
    const stay = (
      lodgingId: string,
      ref: string,
      checkIn: string | null,
      checkOut: string | null,
      extra: Record<string, unknown> = {}
    ) => ({
      lodgingId,
      userId: user.id,
      bookingReference: ref,
      checkIn: checkIn ? day(checkIn) : null,
      checkOut: checkOut ? day(checkOut) : null,
      datePrecision: checkIn ? "DAY" : "NONE",
      ...extra,
    });
    await prisma.lodgingStay.createMany({
      data: [
        stay(adlon.id, "A-early", "2025-03-01", "2025-03-04"),
        stay(adlon.id, "A-june", "2025-06-10", "2025-06-15", { tripId }),
        stay(ibis.id, "I-june", "2025-06-15", "2025-06-18"),
        stay(ibis.id, "I-late", "2025-09-01", "2025-09-02"),
        stay(ibis.id, "I-undated", null, null),
        // Filed by the days columns (ADR 0002): the legacy anchor is an hour
        // off the calendar day, the day columns say 20 July.
        {
          ...stay(ibis.id, "I-dayCols", "2025-07-19", "2025-07-19"),
          checkIn: new Date("2025-07-19T22:00:00.000Z"),
          checkOut: new Date("2025-07-19T22:00:00.000Z"),
          checkInDate: day("2025-07-20"),
          checkOutDate: day("2025-07-20"),
        },
        { ...stay(foreign.id, "SECRET", "2025-06-12", "2025-06-13"), userId: other.id },
      ],
    });
  });

  afterAll(async () => {
    const owners = { in: [user?.id, other?.id] };
    await prisma.lodgingStay.deleteMany({ where: { userId: owners } });
    await prisma.lodging.deleteMany({ where: { userId: owners } });
    await prisma.trip.deleteMany({ where: { userId: owners } });
    await prisma.user.deleteMany({ where: { id: owners } });
  });

  it("lists the account's stays newest check-in first, undated last, each with its house and trip", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ids(res)).toEqual(["I-late", "I-dayCols", "I-june", "A-june", "A-early", "I-undated"]);
    expect(res.body.meta).toEqual({ total: 6, limit: 25, offset: 0 });
    const june = res.body.data.find(
      (s: { bookingReference: string }) => s.bookingReference === "A-june"
    );
    expect(june.lodging).toMatchObject({ name: "Hotel Adlon", city: "Berlin" });
    expect(june.trip).toEqual({ id: tripId, name: "Berlin 2025" });
    // The wire days, not a UTC instant a client could shift by its own zone.
    expect(june.times.checkIn.date).toBe("2025-06-10");
    expect(res.body.data[0].trip).toBeNull();
  });

  it("reverses with order=asc, undated still last", async () => {
    const res = await list({ order: "asc" });
    expect(ids(res)).toEqual(["A-early", "A-june", "I-june", "I-dayCols", "I-late", "I-undated"]);
  });

  it("pages on a total order and reports the size of the whole set", async () => {
    const first = await list({ limit: "2" });
    const second = await list({ limit: "2", offset: "2" });
    const third = await list({ limit: "2", offset: "4" });
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual([
      "I-late",
      "I-dayCols",
      "I-june",
      "A-june",
      "A-early",
      "I-undated",
    ]);
    expect(first.body.meta).toEqual({ total: 6, limit: 2, offset: 0 });
  });

  it("a window returns the stays that touch it - adjacent days included, others not", async () => {
    // 15 June is A-june's check-out AND I-june's check-in: both touch it. The
    // exact "is that an overlap?" answer is the client's (same-day hand-over is not).
    const res = await list({ from: "2025-06-15", to: "2025-06-15" });
    expect(ids(res).sort()).toEqual(["A-june", "I-june"]);
    // Undated stays touch no window.
    const wide = await list({ from: "2025-01-01", to: "2025-12-31" });
    expect(ids(wide)).not.toContain("I-undated");
    expect(wide.body.meta.total).toBe(5);
  });

  it("reads a window by the calendar-day columns, and by the legacy anchor where those are empty", async () => {
    // I-dayCols is on 20 July by its day columns (its legacy anchor says 19 July, 22:00).
    expect(ids(await list({ from: "2025-07-20", to: "2025-07-20" }))).toEqual(["I-dayCols"]);
    expect(ids(await list({ from: "2025-07-19", to: "2025-07-19" }))).toEqual([]);
    // The stays that only have the legacy columns are still found.
    expect(ids(await list({ from: "2025-09-01", to: "2025-09-01" }))).toEqual(["I-late"]);
  });

  it("filters by trip", async () => {
    const res = await list({ tripId });
    expect(ids(res)).toEqual(["A-june"]);
  });

  it("never lists another account's stays", async () => {
    const res = await list({ limit: "500" });
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|Fremdes/);
  });

  it("rejects a malformed day, a reversed window and a non-id trip", async () => {
    expect((await list({ from: "June" })).status).toBe(400);
    expect((await list({ from: "2025-06-10", to: "2025-06-01" })).status).toBe(400);
    expect((await list({ tripId: "nope" })).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/lodging/stays")).status).toBe(401);
  });
});

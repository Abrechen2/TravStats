import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * forgejo#234 / #235: the user's "this change is tight" mark lives on the leg
 * that arrives at the change, is saved by a one-field PATCH that leaves the
 * rest of the ride alone, survives a form save (which never sends it), and the
 * detail read lists every booking leg with what the connection view draws —
 * station ids, the seat, and the mark.
 */
const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const MANNHEIM = { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" };
const BASEL = { name: "Basel SBB", lat: 47.5476, lon: 7.5897, country: "CH" };

describe("rail tight connection mark", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>, as = cookie) =>
    request(app).patch(`/api/v1/rail/${id}`).set("Cookie", as).send(body);

  /** Frankfurt → Mannheim → Basel, bound through one booking. */
  async function connection(): Promise<{ first: string; second: string }> {
    const first = await post({
      departureStation: FRANKFURT,
      arrivalStation: MANNHEIM,
      departureLocal: "2025-03-01T08:00",
      arrivalLocal: "2025-03-01T08:40",
      bookingReference: "AB12CD",
      coach: "7",
      seat: "45",
      travelClass: "second",
    });
    const second = await post({
      departureStation: MANNHEIM,
      arrivalStation: BASEL,
      departureLocal: "2025-03-01T08:47",
      arrivalLocal: "2025-03-01T11:10",
      connectsFrom: first.body.data.id,
    });
    expect(second.status).toBe(201);
    return { first: first.body.data.id, second: second.body.data.id };
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-tight-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `rail-tight-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
  });

  afterEach(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("starts unmarked, and a one-field PATCH marks the arriving leg and nothing else", async () => {
    const { first } = await connection();
    const before = await prisma.railJourney.findUniqueOrThrow({ where: { id: first } });
    expect(before.tightConnection).toBe(false);

    const res = await patch(first, { tightConnection: true });
    expect(res.status).toBe(200);
    expect(res.body.data.tightConnection).toBe(true);

    const after = await prisma.railJourney.findUniqueOrThrow({ where: { id: first } });
    expect(after.tightConnection).toBe(true);
    // The rest of the ride is untouched by the mark.
    expect(after.departureTime.toISOString()).toBe(before.departureTime.toISOString());
    expect(after.arrivalTime?.toISOString()).toBe(before.arrivalTime?.toISOString());
    expect(after.seat).toBe("45");
    expect(after.bookingId).toBe(before.bookingId);

    const cleared = await patch(first, { tightConnection: false });
    expect(cleared.body.data.tightConnection).toBe(false);
  });

  it("keeps the mark through an edit that does not send it", async () => {
    const { first } = await connection();
    await patch(first, { tightConnection: true });
    const res = await patch(first, { notes: "Gleis 3" });
    expect(res.status).toBe(200);
    expect(res.body.data.tightConnection).toBe(true);
  });

  it("refuses a mark that is not a boolean", async () => {
    const { first } = await connection();
    const res = await patch(first, { tightConnection: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RAIL_INVALID_INPUT");
    expect(res.body.field).toBe("tightConnection");
  });

  it("does not let a stranger mark someone else's leg", async () => {
    const { first } = await connection();
    const res = await patch(first, { tightConnection: true }, strangerCookie);
    expect(res.status).toBe(404);
    const row = await prisma.railJourney.findUniqueOrThrow({ where: { id: first } });
    expect(row.tightConnection).toBe(false);
  });

  it("lists every booking leg with its stations, seat and mark on the detail read", async () => {
    const { first, second } = await connection();
    await patch(first, { tightConnection: true });
    const res = await request(app).get(`/api/v1/rail/${second}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const legs = res.body.data.booking.railJourneys as Array<Record<string, unknown>>;
    expect(legs.map((leg) => leg.id)).toEqual([first, second]);
    expect(legs[0]).toMatchObject({
      tightConnection: true,
      coach: "7",
      seat: "45",
      travelClass: "second",
      bookingReference: "AB12CD",
      depStationId: null,
      arrStationId: null,
    });
    expect(legs[1]).toMatchObject({ tightConnection: false, coach: null, seat: null });
  });
});

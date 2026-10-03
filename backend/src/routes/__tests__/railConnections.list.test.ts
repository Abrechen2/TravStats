import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * forgejo#187 — the logbook read as connections. The rule itself is tested in
 * `shared/__tests__/railJourneyGrouping.test.ts`; here: that the endpoints
 * apply it to stored rows, page over connections rather than legs, and leave
 * the leg list and its count alone.
 */
const KOELN = { name: "Köln Hbf", lat: 50.9432, lon: 6.9586, country: "DE" };
const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const MANNHEIM = { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" };
const BASEL = { name: "Basel SBB", lat: 47.5476, lon: 7.5897, country: "CH" };

describe("GET /rail/connections", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;
  /** Köln → Frankfurt → Basel on 1 March, bound by one booking. */
  let changeFirst: string;
  let changeSecond: string;
  /** Frankfurt → Mannheim on 5 March, no booking. */
  let single: string;
  /** Mannheim → Köln on 10 January, no booking, shares the reference only. */
  let sameReference: string;

  const post = async (body: Record<string, unknown>): Promise<string> => {
    const res = await request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const list = (query: Record<string, unknown> = {}, as = cookie) =>
    request(app).get("/api/v1/rail/connections").query(query).set("Cookie", as);
  const shape = (body: { data: Array<{ id: string; legs: Array<{ id: string }> }> }): string[][] =>
    body.data.map((c) => c.legs.map((l) => l.id));

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-cn-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `rail-cn-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;

    changeFirst = await post({
      departureStation: KOELN,
      arrivalStation: FRANKFURT,
      departureLocal: "2025-03-01T07:00",
      arrivalLocal: "2025-03-01T08:05",
      trainCategory: "ICE",
      trainNumber: "101",
      bookingReference: "REF187",
    });
    changeSecond = await post({
      departureStation: FRANKFURT,
      arrivalStation: BASEL,
      departureLocal: "2025-03-01T08:20",
      arrivalLocal: "2025-03-01T11:10",
      trainCategory: "EC",
      trainNumber: "7",
      connectsFrom: changeFirst,
    });
    single = await post({
      departureStation: FRANKFURT,
      arrivalStation: MANNHEIM,
      departureLocal: "2025-03-05T09:00",
      arrivalLocal: "2025-03-05T09:40",
      trainCategory: "RE",
      trainNumber: "4711",
    });
    sameReference = await post({
      departureStation: MANNHEIM,
      arrivalStation: KOELN,
      departureLocal: "2025-01-10T09:00",
      arrivalLocal: "2025-01-10T11:00",
      bookingReference: "REF187",
    });
    // Four writes through the whole create path — more than a hook's 5 s on a busy runner.
  }, 60_000);

  afterEach(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("sends a change of trains as one entry, newest first, and counts entries", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(shape(res.body)).toEqual([[single], [changeFirst, changeSecond], [sameReference]]);
    expect(res.body.data[1].id).toBe(changeFirst);
    expect(res.body.meta).toMatchObject({ total: 3, legTotal: 4, offset: 0 });
    // A leg is the row the leg list sends: its station clock comes along.
    expect(res.body.data[1].legs[0].times.departure.local).toContain("2025-03-01T07:00");
  });

  it("does not group a leg that only shares the booking reference", async () => {
    const res = await list();
    const entry = res.body.data.find((c: { id: string }) => c.id === sameReference);
    expect(entry.legs).toHaveLength(1);
  });

  it("pages over connections: a page boundary never cuts one", async () => {
    const first = await list({ limit: 2, offset: 0 });
    expect(shape(first.body)).toEqual([[single], [changeFirst, changeSecond]]);
    const second = await list({ limit: 2, offset: 2 });
    expect(shape(second.body)).toEqual([[sameReference]]);
    expect(second.body.meta.total).toBe(3);
  });

  it("orders oldest first on request", async () => {
    const res = await list({ order: "asc" });
    expect(shape(res.body)).toEqual([[sameReference], [changeFirst, changeSecond], [single]]);
  });

  it("finds a connection by any of its legs and sends it whole", async () => {
    // Only the second train is an EC to Basel.
    const res = await list({ q: "Basel" });
    expect(shape(res.body)).toEqual([[changeFirst, changeSecond]]);
    expect(res.body.meta).toMatchObject({ total: 1, legTotal: 2 });
  });

  it("refuses a sort it does not offer instead of ignoring it", async () => {
    expect((await list({ sort: "distance" })).status).toBe(400);
  });

  it("shows a stranger nothing", async () => {
    const res = await list({}, strangerCookie);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it("leaves the leg list counting legs", async () => {
    const res = await request(app).get("/api/v1/rail").set("Cookie", cookie);
    expect(res.body.meta.total).toBe(4);
    expect(res.body.data).toHaveLength(4);
  });

  describe("GET /rail/connections/:legId", () => {
    const get = (id: string, as = cookie) =>
      request(app).get(`/api/v1/rail/connections/${id}`).set("Cookie", as);

    it("answers the whole connection from any of its legs, with the booking", async () => {
      for (const id of [changeFirst, changeSecond]) {
        const res = await get(id);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(changeFirst);
        expect(res.body.data.legs.map((l: { id: string }) => l.id)).toEqual([
          changeFirst,
          changeSecond,
        ]);
        expect(res.body.data.booking.pnr).toBe("REF187");
      }
    });

    it("answers a ride without a change as a connection of one", async () => {
      const res = await get(single);
      expect(res.body.data.legs.map((l: { id: string }) => l.id)).toEqual([single]);
      expect(res.body.data.booking).toBeNull();
    });

    it("is a 404 for a stranger and for a leg that does not exist", async () => {
      expect((await get(changeFirst, strangerCookie)).status).toBe(404);
      expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    });
  });
});

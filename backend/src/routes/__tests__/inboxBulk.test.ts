import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Bulk answers in the inbox (owner 2026-11-26): each item through its kind's own service,
 * accept takes only what needs no input (the rest is skipped and stays), and a partial failure
 * is reported per item instead of failing the request.
 */
const USER = "inboxbulkuser";
const BULK = "/api/v1/inbox/bulk";

describe("POST /inbox/bulk", () => {
  let userId: string;
  let cookie: string;
  let placeId: string;
  let n = 0;
  const stay = async (over: Record<string, unknown> = {}) => {
    n += 1;
    const start = new Date(`2026-03-0${n}T10:00:00Z`);
    const end = new Date(`2026-03-0${n}T11:00:00Z`);
    return prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: `bulk-${n}`,
        sourceStartAt: start,
        sourceEndAt: end,
        sourceLat: 48.1,
        sourceLon: 11.5,
        startAt: start,
        endAt: end,
        lat: 48.1,
        lon: 11.5,
        zone: "Europe/Berlin",
        pointCount: 6,
        evidence: { source: "dawarich", zone: "Europe/Berlin", pointIds: [1, 2] },
        ...over,
      },
    });
  };
  const post = (body: unknown) =>
    request(app)
      .post(BULK)
      .set("Cookie", cookie)
      .send(body as object);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    placeId = (await prisma.place.create({ data: { userId, name: "Café", lat: 48.1, lon: 11.5 } }))
      .id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("accepts what needs no input, skips what does, and reports a failure per item", async () => {
    const ready = await stay({ name: "Café", placeId });
    const unnamed = await stay();
    const res = await post({
      action: "accept",
      items: [
        { kind: "dawarich", id: ready.id },
        { kind: "dawarich", id: unnamed.id },
        { kind: "trips", id: "some-trip-proposal" },
        { kind: "updates", id: "00000000-0000-4000-8000-000000000000" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([
      { kind: "dawarich", id: ready.id, outcome: "done" },
      { kind: "dawarich", id: unnamed.id, outcome: "skipped", reason: "needsInput" },
      { kind: "trips", id: "some-trip-proposal", outcome: "skipped", reason: "needsInput" },
      {
        kind: "updates",
        id: "00000000-0000-4000-8000-000000000000",
        outcome: "failed",
        reason: "NOT_FOUND",
      },
    ]);
    expect(res.body.data.summary).toEqual({ done: 1, skipped: 2, failed: 1 });
    expect((await prisma.dawarichStay.findUnique({ where: { id: ready.id } }))?.status).toBe(
      "accepted"
    );
    expect((await prisma.dawarichStay.findUnique({ where: { id: unnamed.id } }))?.status).toBe(
      "pending"
    );
  });

  it("rejects each item through its own service; one refusal does not stop the rest", async () => {
    const a = await stay();
    const res = await post({
      action: "reject",
      items: [
        { kind: "location", id: "00000000-0000-4000-8000-000000000001" },
        { kind: "dawarich", id: a.id },
      ],
    });
    expect(res.body.data.results[0]).toMatchObject({
      outcome: "failed",
      reason: "SUGGESTION_NOT_FOUND",
    });
    expect(res.body.data.results[1]).toEqual({ kind: "dawarich", id: a.id, outcome: "done" });
    expect((await prisma.dawarichStay.findUnique({ where: { id: a.id } }))?.status).toBe(
      "rejected"
    );
  });

  it("refuses an unknown kind (a plugin archive proposal is never a bulk item)", async () => {
    const res = await post({ action: "accept", items: [{ kind: "plugin", id: "r1" }] });
    expect(res.status).toBe(400);
  });
});

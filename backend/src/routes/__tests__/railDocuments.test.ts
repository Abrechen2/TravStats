import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * A rail journey holds documents like a flight or a cruise does (spec
 * 2026-09-25-rail-domain, phase 2b), and its detail read carries the booking
 * that binds a connection's legs.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const MANNHEIM = { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" };
const BASEL = { name: "Basel SBB", lat: 47.5476, lon: 7.5897, country: "CH" };

describe("rail journey documents and booking legs", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;

  const upload = async (tag: string, owner = userId): Promise<string> =>
    (await createDocument({ userId: owner, buffer: PDF(`${tag}-${stamp}`) })).document.id;

  const journey = (extra: Record<string, unknown> = {}) => ({
    departureStation: FRANKFURT,
    arrivalStation: MANNHEIM,
    departureLocal: "2025-03-01T08:00",
    arrivalLocal: "2025-03-01T08:40",
    ...extra,
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-doc-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `rail-doc-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
  });

  afterEach(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("files documents with a new journey and lists them under it", async () => {
    const id = await upload("ticket");
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({ ...journey(), documentIds: [id] });
    expect(res.status).toBe(201);
    const journeyId = res.body.data.id as string;

    const filed = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(filed.railJourneyId).toBe(journeyId);
    expect(filed.unlinkedAt).toBeNull();

    const list = await request(app)
      .get(`/api/v1/rail/${journeyId}/documents`)
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([id]);
    expect(list.body.data[0].entry).toEqual({ type: "railJourney", id: journeyId });
  });

  it("refuses a stranger's journey as a document's entry and as a list", async () => {
    const res = await request(app).post("/api/v1/rail").set("Cookie", cookie).send(journey());
    const journeyId = res.body.data.id as string;

    const list = await request(app)
      .get(`/api/v1/rail/${journeyId}/documents`)
      .set("Cookie", strangerCookie);
    expect(list.status).toBe(404);

    const theirs = await upload("stranger", strangerId);
    const link = await request(app)
      .patch(`/api/v1/documents/${theirs}`)
      .set("Cookie", strangerCookie)
      .send({ entry: { type: "railJourney", id: journeyId } });
    expect(link.status).toBe(404);
  });

  it("holds the single-owner rule in the database for the sixth owner", async () => {
    const res = await request(app).post("/api/v1/rail").set("Cookie", cookie).send(journey());
    const trip = await prisma.trip.create({ data: { userId, name: `rail-doc-trip-${stamp}` } });
    const id = await upload("two-owners");

    await expect(
      prisma.document.update({
        where: { id },
        data: { railJourneyId: res.body.data.id, tripId: trip.id },
      })
    ).rejects.toThrow(/documents_single_owner_check/);
  });

  it("deletes a journey's documents with the journey", async () => {
    const id = await upload("cascade");
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({ ...journey(), documentIds: [id] });
    await request(app).delete(`/api/v1/rail/${res.body.data.id}`).set("Cookie", cookie);
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
  });

  it("reads a journey with its booking's other legs, in departure order", async () => {
    const booking = await prisma.booking.create({ data: { userId, pnr: "RAIL42" } });
    const second = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        ...journey({
          departureStation: MANNHEIM,
          arrivalStation: BASEL,
          departureLocal: "2025-03-01T08:55",
          arrivalLocal: "2025-03-01T11:10",
        }),
        bookingId: booking.id,
      });
    const first = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({ ...journey(), bookingId: booking.id });

    const res = await request(app).get(`/api/v1/rail/${second.body.data.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.booking.pnr).toBe("RAIL42");
    expect(res.body.data.booking.railJourneys.map((l: { id: string }) => l.id)).toEqual([
      first.body.data.id,
      second.body.data.id,
    ]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { UNLINKED_TTL_DAYS, sweepDocuments } from "../../services/documents/documentService";

/**
 * An unfiled upload is deleted — row and bytes — by the hourly sweep, and until
 * 2026-09-19 nothing said so: no screen, no locale string, no endpoint. The
 * 2026-09-19 integrity audit found the TTL at seven days and silent.
 *
 * It is thirty days now, and it is announced. This pins the announcement: the
 * list exists, it is the caller's own, and it carries the exact date.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

interface UnfiledDto {
  id: string;
  displayName: string;
  createdAt: string;
  deletesAt: string;
  entry: unknown;
}

describe("GET /documents/unfiled", () => {
  const stamp = Date.now();
  let ownerId: string;
  let strangerId: string;
  let ownerCookie: string;
  let strangerCookie: string;
  let flightId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    ownerId = (
      await prisma.user.create({ data: { username: `docs-unfiled-owner-${stamp}`, passwordHash } })
    ).id;
    strangerId = (
      await prisma.user.create({
        data: { username: `docs-unfiled-stranger-${stamp}`, passwordHash },
      })
    ).id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    flightId = (
      await prisma.flight.create({
        data: {
          userId: ownerId,
          depIata: "FRA",
          depLat: 50.03,
          depLon: 8.56,
          arrIata: "MUC",
          arrLat: 48.35,
          arrLon: 11.78,
          departureTime: new Date("2024-05-01T08:00:00Z"),
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  });

  async function upload(cookie: string, tag: string, entry?: { type: string; id: string }) {
    const req = request(app)
      .post("/api/v1/documents")
      .set("Cookie", cookie)
      .attach("file", PDF(tag), `${tag}.pdf`);
    if (entry) req.field("entryType", entry.type).field("entryId", entry.id);
    const res = await req;
    expect([200, 201]).toContain(res.status);
    return res.body.data.id as string;
  }

  it("lists only the caller's unfiled uploads, and says when each one goes", async () => {
    const loose = await upload(ownerCookie, "loose-one");
    const filed = await upload(ownerCookie, "filed-one", { type: "flight", id: flightId });
    const strangers = await upload(strangerCookie, "stranger-one");

    const res = await request(app).get("/api/v1/documents/unfiled").set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.data as UnfiledDto[]).map((d) => d.id);
    expect(ids).toContain(loose);
    // Filed with a flight, so it is not going anywhere.
    expect(ids).not.toContain(filed);
    // Somebody else's, so it is none of this caller's business.
    expect(ids).not.toContain(strangers);

    const row = (res.body.data as UnfiledDto[]).find((d) => d.id === loose)!;
    expect(row.entry).toBeNull();
    expect(row.displayName).toBe("loose-one.pdf");
    // Measured from `unlinkedAt`, which for a freshly uploaded document is the
    // same moment as `createdAt` — but stamped by a different clock (Postgres'
    // `now()` against the server's `new Date()`), so they differ by a
    // millisecond or two. A second of slack, not an exact equality.
    const expected = new Date(row.createdAt).getTime() + UNLINKED_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(row.deletesAt!).getTime() - expected)).toBeLessThan(1000);
  });

  it("gives the user thirty days, not seven", async () => {
    // The number is the owner's ruling of 2026-09-19. It is asserted here and
    // not only in the constant, because the date on screen is the promise.
    expect(UNLINKED_TTL_DAYS).toBe(30);
  });

  it("drops a document off the list the moment it is filed", async () => {
    const id = await upload(ownerCookie, "about-to-be-filed");

    const before = await request(app).get("/api/v1/documents/unfiled").set("Cookie", ownerCookie);
    expect((before.body.data as UnfiledDto[]).map((d) => d.id)).toContain(id);

    await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ entry: { type: "flight", id: flightId } })
      .expect(200);

    const after = await request(app).get("/api/v1/documents/unfiled").set("Cookie", ownerCookie);
    expect((after.body.data as UnfiledDto[]).map((d) => d.id)).not.toContain(id);
  });

  it("restarts the clock when an OLD document is unfiled", async () => {
    // The defect this pins: the sweep and `deletesAt` counted from `createdAt`,
    // the age of the FILE. A document uploaded two months ago and unfiled today
    // was therefore already past a 30-day TTL the instant it was unfiled — the
    // inbox showed a deletion date in the PAST and the next hourly pass deleted
    // it. The TTL is about how long it has belonged to nothing.
    const id = await upload(ownerCookie, "old-and-filed", { type: "flight", id: flightId });
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await prisma.document.update({ where: { id }, data: { createdAt: longAgo } });

    // Unfile it, now.
    await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ entry: null })
      .expect(200);

    const res = await request(app).get("/api/v1/documents/unfiled").set("Cookie", ownerCookie);
    const row = (res.body.data as UnfiledDto[]).find((d) => d.id === id)!;

    // Uploaded two months ago, and still has its full thirty days.
    expect(new Date(row.createdAt).getTime()).toBeLessThan(longAgo.getTime() + 60_000);
    const daysFromNow = (new Date(row.deletesAt!).getTime() - Date.now()) / 86_400_000;
    expect(daysFromNow).toBeGreaterThan(UNLINKED_TTL_DAYS - 1);
    expect(daysFromNow).toBeLessThanOrEqual(UNLINKED_TTL_DAYS);

    // And the sweep agrees with the screen — on the old code it deleted this
    // row on its next pass.
    const result = await sweepDocuments();
    expect(result.expiredUnfiled).toBe(0);
    expect(await prisma.document.findUnique({ where: { id } })).not.toBeNull();
  });

  it("sweeps a document that has been unfiled for longer than the TTL", async () => {
    const id = await upload(ownerCookie, "unfiled-long-ago");
    const past = new Date(Date.now() - (UNLINKED_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    await prisma.document.update({ where: { id }, data: { unlinkedAt: past } });

    const result = await sweepDocuments();

    expect(result.expiredUnfiled).toBeGreaterThanOrEqual(1);
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/v1/documents/unfiled");
    expect(res.status).toBe(401);
  });
});

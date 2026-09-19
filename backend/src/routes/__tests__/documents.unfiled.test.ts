import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { UNLINKED_TTL_DAYS } from "../../services/documents/documentService";

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
    const expected = new Date(row.createdAt).getTime() + UNLINKED_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(new Date(row.deletesAt).getTime()).toBe(expected);
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

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/v1/documents/unfiled");
    expect(res.status).toBe(401);
  });
});

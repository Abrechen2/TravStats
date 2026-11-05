import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";

/**
 * The spreadsheet export had no sheet for documents because no endpoint listed
 * them all: only per-entry lists and the unfiled inbox existed.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("GET /documents lists every document the caller owns, metadata only", () => {
  const stamp = Date.now();
  let ownerId: string;
  let strangerId: string;
  let emptyId: string;
  let ownerCookie: string;
  let strangerCookie: string;
  let emptyCookie: string;
  let tripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const mk = async (name: string): Promise<string> =>
      (await prisma.user.create({ data: { username: `docs-list-${name}-${stamp}`, passwordHash } }))
        .id;
    ownerId = await mk("owner");
    strangerId = await mk("stranger");
    emptyId = await mk("empty");
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    emptyCookie = `auth_token=${generateToken(emptyId)}`;
    tripId = (await prisma.trip.create({ data: { userId: ownerId, name: "Doc trip" } })).id;
  });

  afterAll(async () => {
    const ids = [ownerId, strangerId, emptyId];
    const rows = await prisma.document.findMany({ where: { userId: { in: ids } } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
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

  it("returns filed and unfiled documents of the caller, never a stranger's", async () => {
    const filed = await upload(ownerCookie, "list-filed", { type: "trip", id: tripId });
    const loose = await upload(ownerCookie, "list-loose");
    const theirs = await upload(strangerCookie, "list-theirs");

    const res = await request(app).get("/api/v1/documents").set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    const ids = (res.body.data.documents as { id: string }[]).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([filed, loose]));
    expect(ids).not.toContain(theirs);
    expect(res.body.data.total).toBe(2);
    const row = res.body.data.documents.find((d: { id: string }) => d.id === filed);
    expect(row.entry).toEqual({ type: "trip", id: tripId });
    expect(row.displayName).toBe("list-filed.pdf");
    expect(row.kind).toBeNull();
    // Metadata only: a path to the bytes, never the bytes.
    expect(row.url).toBe(`/api/v1/documents/${filed}/file`);
    expect(JSON.stringify(row)).not.toContain("%PDF");
  });

  it("pages, and says the total so a client knows it has them all", async () => {
    const res = await request(app)
      .get("/api/v1/documents?limit=1&offset=1")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.documents).toHaveLength(1);
    expect(res.body.data.total).toBe(2);
  });

  it("answers an empty list for an account with no documents", async () => {
    const res = await request(app).get("/api/v1/documents").set("Cookie", emptyCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ documents: [], total: 0 });
  });

  it("refuses an anonymous caller", async () => {
    await request(app).get("/api/v1/documents").expect(401);
  });
});

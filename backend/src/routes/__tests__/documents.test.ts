import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";

/**
 * The HTTP contract of kept originals (forgejo#116), as the Companion codes
 * against it: the capability probe, 201-then-200 on a repeated send, the
 * per-entry lists under each entry's own path, and 404 — never 403 — for
 * anything that belongs to someone else.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("documents routes", () => {
  const stamp = Date.now();
  let ownerId: string;
  let strangerId: string;
  let ownerCookie: string;
  let strangerCookie: string;
  let flightId: string;
  let stayId: string;
  let strangerFlightId: string;

  const flightData = (userId: string) => ({
    userId,
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "MUC",
    arrLat: 48.35,
    arrLon: 11.78,
    departureTime: new Date("2024-05-01T08:00:00Z"),
    status: "flown",
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    ownerId = (
      await prisma.user.create({ data: { username: `docs-route-owner-${stamp}`, passwordHash } })
    ).id;
    strangerId = (
      await prisma.user.create({ data: { username: `docs-route-stranger-${stamp}`, passwordHash } })
    ).id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    flightId = (await prisma.flight.create({ data: flightData(ownerId) })).id;
    strangerFlightId = (await prisma.flight.create({ data: flightData(strangerId) })).id;
    const lodging = await prisma.lodging.create({
      data: { userId: ownerId, name: "Hotel Adlon", type: "hotel" },
    });
    stayId = (await prisma.lodgingStay.create({ data: { lodgingId: lodging.id, userId: ownerId } }))
      .id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [ownerId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  });

  it("answers the capability probe with the owner's size limits", async () => {
    const res = await request(app).get("/api/v1/documents/limits").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      image: 10 * 1024 * 1024,
      pdf: 10 * 1024 * 1024,
      eml: 2 * 1024 * 1024,
      emailText: 2 * 1024 * 1024,
      pkpass: 5 * 1024 * 1024,
    });
  });

  it("refuses the probe without a session", async () => {
    const res = await request(app).get("/api/v1/documents/limits");
    expect(res.status).toBe(401);
  });

  it("answers 201 for a new original and 200 with the same document for a retried send", async () => {
    const send = () =>
      request(app)
        .post("/api/v1/documents")
        .set("Cookie", ownerCookie)
        .field("clientDocumentId", "client-1")
        .field("entryType", "flight")
        .field("entryId", flightId)
        .field("format", "pdf")
        .field("displayName", "Rechnung.pdf")
        .field("source", "companion")
        .attach("file", PDF("retry"), { filename: "Rechnung.pdf", contentType: "application/pdf" });

    const first = await send();
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      format: "pdf",
      displayName: "Rechnung.pdf",
      mimetype: "application/pdf",
      source: "companion",
      entry: { type: "flight", id: flightId },
    });

    const second = await send();
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.document.count({ where: { userId: ownerId, flightId } })).toBe(1);
  });

  it("refuses a file whose bytes contradict the declared format", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("format", "pdf")
      .attach("file", JPEG, { filename: "scan.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(415);
  });

  it("recognises a mail file declared by format even when the part arrives as octet-stream", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("format", "eml")
      .attach("file", Buffer.from("From: a@b.example\r\nSubject: Booking\r\n\r\nHi"), {
        filename: "upload",
        contentType: "application/octet-stream",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.format).toBe("eml");
  });

  it("answers 400 when entryType comes without entryId", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("entryType", "flight")
      .attach("file", PDF("half-entry"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("answers 413 for a file above the largest limit, before reading it all", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .attach("file", Buffer.concat([PDF("big"), Buffer.alloc(10 * 1024 * 1024 + 1)]), {
        filename: "big.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(413);
  });

  it("answers 404 when filing with another user's entry", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("entryType", "flight")
      .field("entryId", strangerFlightId)
      .attach("file", PDF("foreign-entry"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });

  it("lists an entry's documents under the entry's own path, lodging stays included", async () => {
    await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("entryType", "lodgingStay")
      .field("entryId", stayId)
      .attach("file", PDF("stay"), { filename: "Hotel.pdf", contentType: "application/pdf" });

    const stay = await request(app)
      .get(`/api/v1/lodging/stays/${stayId}/documents`)
      .set("Cookie", ownerCookie);
    expect(stay.status).toBe(200);
    expect(stay.body.data.map((d: { displayName: string }) => d.displayName)).toEqual([
      "Hotel.pdf",
    ]);

    const foreign = await request(app)
      .get(`/api/v1/flights/${strangerFlightId}/documents`)
      .set("Cookie", ownerCookie);
    expect(foreign.status).toBe(404);
  });

  it("serves the bytes privately to the owner and 404s for anyone else", async () => {
    const created = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .attach("file", PDF("serve"), { filename: "serve.pdf", contentType: "application/pdf" });
    const id = created.body.data.id as string;

    const own = await request(app)
      .get(`/api/v1/documents/${id}/file`)
      .set("Cookie", ownerCookie)
      .buffer(true);
    expect(own.status).toBe(200);
    expect(own.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(own.headers["cache-control"]).toBe("private, max-age=3600");
    expect(Buffer.from(own.body as Buffer).equals(PDF("serve"))).toBe(true);

    for (const path of [`/api/v1/documents/${id}`, `/api/v1/documents/${id}/file`]) {
      const res = await request(app).get(path).set("Cookie", strangerCookie);
      expect(res.status).toBe(404);
    }
  });

  it("files, describes and unfiles a document through PATCH", async () => {
    const created = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .attach("file", PDF("patch"), { filename: "patch.pdf", contentType: "application/pdf" });
    const id = created.body.data.id as string;
    expect(created.body.data.entry).toBeNull();

    const filed = await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ kind: "invoice", issuedOn: "2024-05-02", entry: { type: "flight", id: flightId } });
    expect(filed.status).toBe(200);
    expect(filed.body.data).toMatchObject({
      kind: "invoice",
      issuedOn: "2024-05-02",
      entry: { type: "flight", id: flightId },
    });

    const moved = await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ entry: { type: "lodgingStay", id: stayId } });
    expect(moved.status).toBe(409);

    const unfiled = await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ entry: null });
    expect(unfiled.status).toBe(200);
    expect(unfiled.body.data.entry).toBeNull();

    const unknownField = await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set("Cookie", ownerCookie)
      .send({ sha256: "0".repeat(64) });
    expect(unknownField.status).toBe(400);
  });

  it("deletes row and file, and a second delete is a 404", async () => {
    const created = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .attach("file", PDF("delete"), { filename: "delete.pdf", contentType: "application/pdf" });
    const id = created.body.data.id as string;
    const row = await prisma.document.findUniqueOrThrow({ where: { id } });

    const strangerDelete = await request(app)
      .delete(`/api/v1/documents/${id}`)
      .set("Cookie", strangerCookie);
    expect(strangerDelete.status).toBe(404);

    const res = await request(app).delete(`/api/v1/documents/${id}`).set("Cookie", ownerCookie);
    expect(res.status).toBe(204);
    expect(fs.existsSync(documentPath(row.storedName))).toBe(false);

    const again = await request(app).delete(`/api/v1/documents/${id}`).set("Cookie", ownerCookie);
    expect(again.status).toBe(404);
  });
});

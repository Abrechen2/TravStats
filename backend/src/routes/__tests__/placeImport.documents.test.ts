/**
 * A place read from a document keeps the document: the ticket is filed on the
 * visit the import writes. The tile used to parse without `retain`, so the
 * ticket a museum visit came from was gone the moment it was read.
 */
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

jest.mock("../../services/dataQuality", () => ({
  runDataQualityChecks: jest.fn(async () => ({
    opened: 0,
    reopened: 0,
    updated: 0,
    autoResolved: 0,
    open: 0,
  })),
}));

describe("POST /place-import/commit with documentIds", () => {
  let userId: string;
  let otherUserId: string;
  let cookie: string;

  const doc = (owner: string, tag: string) =>
    prisma.document.create({
      data: {
        userId: owner,
        storedName: `${tag}.pdf`,
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: `${tag}-${Date.now()}`,
        format: "pdf",
        kind: "ticket",
      },
    });

  const commit = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/place-import/commit").set("Cookie", cookie).send(body);

  const row = (tag: string, visitedAt: string | null) => ({
    sourceRowIndex: 0,
    name: `Museum ${tag}`,
    lat: 48.137,
    lon: 11.575,
    visitedAt,
    externalRef: `csv:place-doc-${tag}-${Date.now()}`,
  });

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { username: `place-doc-${stamp}`, passwordHash: await hashPassword("pw123456") },
    });
    const other = await prisma.user.create({
      data: { username: `place-doc-other-${stamp}`, passwordHash: await hashPassword("pw123456") },
    });
    userId = user.id;
    otherUserId = other.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("files the document on the visit the import wrote", async () => {
    const ticket = await doc(userId, "museum-ticket");
    const res = await commit({
      source: "document",
      fileName: null,
      rows: [row("dated", "2025-05-10")],
      documentIds: [ticket.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.documentsFiled).toBe(1);
    const visit = await prisma.placeVisit.findFirstOrThrow({
      where: { userId, place: { name: "Museum dated" } },
    });
    const filed = await prisma.document.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(filed.placeVisitId).toBe(visit.id);
  });

  it("leaves the document unfiled when the import wrote no visit, and says so", async () => {
    const ticket = await doc(userId, "undated-ticket");
    const res = await commit({
      source: "document",
      rows: [row("undated", null)],
      documentIds: [ticket.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.documentsFiled).toBe(0);
    const kept = await prisma.document.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(kept.placeVisitId).toBeNull();
  });

  it("refuses another account's document before writing anything", async () => {
    const foreign = await doc(otherUserId, "foreign-ticket");
    const res = await commit({
      source: "document",
      rows: [row("foreign", "2025-05-10")],
      documentIds: [foreign.id],
    });
    expect(res.status).toBe(404);
    expect(await prisma.place.count({ where: { userId, name: "Museum foreign" } })).toBe(0);
  });
});

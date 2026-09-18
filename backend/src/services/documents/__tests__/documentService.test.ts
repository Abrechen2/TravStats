import fs from "fs";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { documentPath } from "../documentStore";
import {
  UNLINKED_TTL_DAYS,
  assertLinkable,
  createDocument,
  deleteDocument,
  linkDocuments,
  listDocumentsForEntry,
  sweepDocuments,
  unlinkDocument,
} from "../documentService";

/**
 * The rules of forgejo#116, against a real database and real files.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const PREFIX = `doc-svc-${Date.now()}`;

describe("documentService", () => {
  let userId: string;
  let otherUserId: string;
  let flightId: string;
  let tripId: string;
  let otherFlightId: string;

  const flightData = (uid: string): Parameters<typeof prisma.flight.create>[0]["data"] => ({
    userId: uid,
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
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${PREFIX}-a`, passwordHash } })).id;
    otherUserId = (await prisma.user.create({ data: { username: `${PREFIX}-b`, passwordHash } }))
      .id;
    flightId = (await prisma.flight.create({ data: flightData(userId) })).id;
    otherFlightId = (await prisma.flight.create({ data: flightData(otherUserId) })).id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Doc trip", status: "completed" } }))
      .id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, otherUserId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("keeps the bytes on disk and a row that describes them", async () => {
    const { document, created } = await createDocument({
      userId,
      buffer: PDF("keep"),
      originalName: "Rechnung.pdf",
    });
    expect(created).toBe(true);
    expect(document.format).toBe("pdf");
    expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.originalName).toBe("Rechnung.pdf");
    expect(fs.readFileSync(documentPath(document.storedName)).toString()).toContain("% keep");
  });

  it("returns the same document for a retried upload to the same target", async () => {
    const first = await createDocument({
      userId,
      buffer: PDF("retry"),
      entry: { type: "flight", id: flightId },
    });
    const second = await createDocument({
      userId,
      buffer: PDF("retry"),
      entry: { type: "flight", id: flightId },
    });
    expect(second.created).toBe(false);
    expect(second.document.id).toBe(first.document.id);
    expect(await prisma.document.count({ where: { userId, sha256: first.document.sha256 } })).toBe(
      1
    );
  });

  it("files an earlier unfiled copy instead of storing the bytes twice", async () => {
    const unfiled = await createDocument({ userId, buffer: PDF("late-link") });
    const filed = await createDocument({
      userId,
      buffer: PDF("late-link"),
      entry: { type: "trip", id: tripId },
    });
    expect(filed.created).toBe(false);
    expect(filed.document.id).toBe(unfiled.document.id);
    expect(filed.document.tripId).toBe(tripId);
    expect(filed.document.linkedAt).not.toBeNull();
  });

  it("links after the entry exists, and lists it there", async () => {
    const { document } = await createDocument({ userId, buffer: PDF("after") });
    await linkDocuments(userId, [document.id], { type: "flight", id: flightId });
    const listed = await listDocumentsForEntry(userId, { type: "flight", id: flightId });
    expect(listed.map((d) => d.id)).toContain(document.id);
  });

  it("refuses to move a document that is filed elsewhere", async () => {
    const { document } = await createDocument({
      userId,
      buffer: PDF("filed"),
      entry: { type: "trip", id: tripId },
    });
    await expect(
      assertLinkable(userId, [document.id], { type: "flight", id: flightId })
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("treats another user's entry and another user's document as not found", async () => {
    await expect(
      createDocument({
        userId,
        buffer: PDF("stranger"),
        entry: { type: "flight", id: otherFlightId },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    const theirs = await createDocument({ userId: otherUserId, buffer: PDF("theirs") });
    await expect(assertLinkable(userId, [theirs.document.id])).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects what it cannot recognise, and what is too large", async () => {
    await expect(
      createDocument({ userId, buffer: Buffer.from([1, 2, 3, 4]), originalName: "x.bin" })
    ).rejects.toMatchObject({
      statusCode: 415,
    });
    const bigMail = Buffer.alloc(2 * 1024 * 1024 + 1, "a");
    await expect(
      createDocument({ userId, buffer: bigMail, originalName: "big.eml" })
    ).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it("enforces a single owner in the database itself", async () => {
    const { document } = await createDocument({
      userId,
      buffer: PDF("check"),
      entry: { type: "flight", id: flightId },
    });
    await expect(
      prisma.document.update({ where: { id: document.id }, data: { tripId } })
    ).rejects.toThrow();
  });

  it("deletes the row and the file", async () => {
    const { document } = await createDocument({ userId, buffer: PDF("delete") });
    await deleteDocument(userId, document.id);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(fs.existsSync(documentPath(document.storedName))).toBe(false);
  });

  it("unlinking returns a document to unfiled", async () => {
    const { document } = await createDocument({
      userId,
      buffer: PDF("unlink"),
      entry: { type: "trip", id: tripId },
    });
    const unlinked = await unlinkDocument(userId, document.id);
    expect(unlinked.tripId).toBeNull();
    expect(unlinked.linkedAt).toBeNull();
  });

  it("sweeps unfiled uploads past their TTL and files without a row, but not filed ones", async () => {
    const stale = await createDocument({ userId, buffer: PDF("stale") });
    const filed = await createDocument({
      userId,
      buffer: PDF("keep-filed"),
      entry: { type: "flight", id: flightId },
    });
    const old = new Date(Date.now() - (UNLINKED_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    await prisma.document.updateMany({
      where: { id: { in: [stale.document.id, filed.document.id] } },
      data: { createdAt: old },
    });
    const orphanName = `orphan-${PREFIX}.pdf`;
    fs.writeFileSync(documentPath(orphanName), "%PDF orphan");

    const result = await sweepDocuments(new Date(), async () => 2 * 60 * 60 * 1000);

    expect(result.expiredUnfiled).toBeGreaterThanOrEqual(1);
    expect(await prisma.document.findUnique({ where: { id: stale.document.id } })).toBeNull();
    expect(fs.existsSync(documentPath(stale.document.storedName))).toBe(false);
    expect(await prisma.document.findUnique({ where: { id: filed.document.id } })).not.toBeNull();
    expect(fs.existsSync(documentPath(orphanName))).toBe(false);
  });

  it("leaves a file alone that is younger than an hour, even without a row", async () => {
    const youngName = `young-${PREFIX}.pdf`;
    fs.writeFileSync(documentPath(youngName), "%PDF young");
    await sweepDocuments(new Date(), async (name) =>
      name === youngName ? 5 * 60 * 1000 : 2 * 60 * 60 * 1000
    );
    expect(fs.existsSync(documentPath(youngName))).toBe(true);
    fs.rmSync(documentPath(youngName), { force: true });
  });

  it("removes a deleted entry's bytes on the next sweep, whichever route deleted the entry", async () => {
    const doomedFlight = await prisma.flight.create({ data: flightData(userId) });
    const { document } = await createDocument({
      userId,
      buffer: PDF("doomed"),
      entry: { type: "flight", id: doomedFlight.id },
    });
    await prisma.flight.delete({ where: { id: doomedFlight.id } });
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(fs.existsSync(documentPath(document.storedName))).toBe(true);

    await sweepDocuments(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(fs.existsSync(documentPath(document.storedName))).toBe(false);
  });

  it("reads a file's real age when the scheduler calls it without an age function", async () => {
    // The scheduler passes nothing. Before the default read the file's mtime,
    // "no age" meant "old enough" — and an upload mid-insert lost its bytes.
    const freshName = `fresh-${PREFIX}.pdf`;
    fs.writeFileSync(documentPath(freshName), "%PDF fresh");
    await sweepDocuments();
    expect(fs.existsSync(documentPath(freshName))).toBe(true);

    const past = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await sweepDocuments(past);
    expect(fs.existsSync(documentPath(freshName))).toBe(false);
  });
});

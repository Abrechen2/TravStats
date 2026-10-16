import fs from "fs";

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { documentPath } from "../documentStore";
import {
  UNLINKED_TTL_DAYS,
  createDocument,
  deleteDocument,
  sweepDocuments,
} from "../documentService";

/**
 * One booking mail belongs to every flight it booked. Filed with four flights it
 * is four rows — the single-owner rule stays — but it must be ONE file: before
 * this, the same bytes were written once per row, and prod held 19 contents in
 * 49 files (7.6 MB of 52 MB twice). The file is named by its content, and it
 * goes only when the last row that names it goes.
 */
const MAIL = (tag: string): Buffer =>
  Buffer.from(
    `From: Lufthansa <noreply@lufthansa.com>\r\nSubject: Ihre Buchung ${tag}\r\nDate: Mon, 2 Sep 2024 10:00:00 +0200\r\n\r\nLH2460 MUC-HEL\r\n`
  );
const PREFIX = `doc-shared-${Date.now()}`;

describe("documentService — one file per content", () => {
  let userId: string;
  let otherUserId: string;
  let outboundId: string;
  let returnId: string;
  let otherFlightId: string;

  const flight = (uid: string): import("../../../prisma").Prisma.FlightUncheckedCreateInput => ({
    userId: uid,
    depIata: "MUC",
    depLat: 48.35,
    depLon: 11.78,
    arrIata: "HEL",
    arrLat: 60.32,
    arrLon: 24.96,
    departureTime: new Date("2024-11-07T07:25:00Z"),
    status: "flown",
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${PREFIX}-a`, passwordHash } })).id;
    otherUserId = (await prisma.user.create({ data: { username: `${PREFIX}-b`, passwordHash } }))
      .id;
    outboundId = (await prisma.flight.create({ data: flight(userId) })).id;
    returnId = (await prisma.flight.create({ data: flight(userId) })).id;
    otherFlightId = (await prisma.flight.create({ data: flight(otherUserId) })).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, otherUserId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("files the same mail with two flights as two rows over one file", async () => {
    const bytes = MAIL("two-flights");
    const a = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: outboundId },
    });
    const b = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: returnId },
    });

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.document.id).not.toBe(a.document.id);
    expect(b.document.storedName).toBe(a.document.storedName);
    expect(a.document.storedName).toBe(`${a.document.sha256}.eml`);
    expect(fs.readFileSync(documentPath(a.document.storedName))).toEqual(bytes);
  });

  it("keeps the file while another row still names it, and removes it with the last", async () => {
    const bytes = MAIL("delete-order");
    const a = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: outboundId },
    });
    const b = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: returnId },
    });
    const file = documentPath(a.document.storedName);

    await deleteDocument(userId, a.document.id);
    expect(fs.existsSync(file)).toBe(true);

    await deleteDocument(userId, b.document.id);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("shares the file across accounts, and one account's delete leaves the other's", async () => {
    const bytes = MAIL("two-accounts");
    const mine = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: outboundId },
    });
    const theirs = await createDocument({
      userId: otherUserId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: otherFlightId },
    });
    expect(theirs.document.storedName).toBe(mine.document.storedName);

    await deleteDocument(userId, mine.document.id);
    expect(fs.readFileSync(documentPath(theirs.document.storedName))).toEqual(bytes);
  });

  it("does not let the TTL sweep take a file a filed row still needs", async () => {
    const bytes = MAIL("sweep-shared");
    const unfiled = await createDocument({ userId, buffer: bytes, originalName: "Buchung.eml" });
    const filed = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: returnId },
    });
    // The retried-offline-send rule files an unfiled copy instead of making a
    // second row; force two rows by filing the second elsewhere first.
    expect(filed.document.id).toBe(unfiled.document.id);

    const again = await createDocument({ userId, buffer: bytes, originalName: "Buchung.eml" });
    const old = new Date(Date.now() - (UNLINKED_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    await prisma.document.update({ where: { id: again.document.id }, data: { unlinkedAt: old } });

    await sweepDocuments(new Date(), async () => 0);

    expect(await prisma.document.findUnique({ where: { id: again.document.id } })).toBeNull();
    expect(fs.existsSync(documentPath(filed.document.storedName))).toBe(true);
  });

  it("writes the file again when a row names it but it is gone from disk", async () => {
    const bytes = MAIL("rewrite-missing");
    const first = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: outboundId },
    });
    fs.rmSync(documentPath(first.document.storedName));

    const second = await createDocument({
      userId,
      buffer: bytes,
      originalName: "Buchung.eml",
      entry: { type: "flight", id: returnId },
    });
    expect(fs.readFileSync(documentPath(second.document.storedName))).toEqual(bytes);
  });
});

import fs from "fs";
import path from "path";

import { prisma } from "../../../db";
import { getUploadDir } from "../../../middleware/upload";
import { receiptUrlValidator } from "../../../schemas/receiptUrl";
import { hashPassword } from "../../../utils/password";
import { createDocument, deleteDocument } from "../documentService";
import { documentPath } from "../documentStore";
import {
  RECEIPT_SOURCE,
  migrateLegacyReceipts,
  reconcileReceiptDocuments,
  receiptUrlFor,
} from "../receipts";

/**
 * Receipts as kept documents (forgejo#116, owner decision 2026-09-17): the
 * document follows the `receiptUrl` that names it, a legacy upload moves across
 * once, and deleting the document does not leave a dead link on the entry.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const PREFIX = `receipts-${Date.now()}`;

describe("receipts as documents", () => {
  let userId: string;
  let flightId: string;
  let stayId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: PREFIX, passwordHash: await hashPassword("password123") },
      })
    ).id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
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
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Beleg-Hotel", type: "hotel" },
    });
    stayId = (await prisma.lodgingStay.create({ data: { userId, lodgingId: lodging.id } })).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  const receipt = async (tag: string) =>
    (
      await createDocument({
        userId,
        buffer: PDF(`${PREFIX}-${tag}`),
        source: RECEIPT_SOURCE,
        kind: "invoice",
      })
    ).document;

  it("files a receipt with the entry that names it, and unfiles it when the entry lets go", async () => {
    const doc = await receipt("follow");
    await prisma.flight.update({
      where: { id: flightId },
      data: { receiptUrl: receiptUrlFor(doc.id) },
    });

    await reconcileReceiptDocuments();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).flightId).toBe(
      flightId
    );

    await prisma.flight.update({ where: { id: flightId }, data: { receiptUrl: null } });
    await reconcileReceiptDocuments();
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).flightId
    ).toBeNull();
  });

  it("leaves a document that is not a receipt where it was filed", async () => {
    const { document } = await createDocument({
      userId,
      buffer: PDF(`${PREFIX}-companion`),
      source: "companion",
      entry: { type: "lodgingStay", id: stayId },
    });
    await reconcileReceiptDocuments();
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).lodgingStayId
    ).toBe(stayId);
  });

  it("moves a legacy receipt into documents and points the stay at it", async () => {
    const filename = `${PREFIX}-legacy.pdf`;
    fs.writeFileSync(path.join(getUploadDir(), filename), PDF(`${PREFIX}-legacy`));
    await prisma.receiptUpload.create({ data: { filename, userId } });
    await prisma.lodgingStay.update({
      where: { id: stayId },
      data: { receiptUrl: `/api/v1/uploads/receipts/${filename}` },
    });

    const result = await migrateLegacyReceipts();
    expect(result.migrated).toBeGreaterThanOrEqual(1);

    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stayId } });
    const doc = await prisma.document.findFirstOrThrow({
      where: { userId, originalName: filename },
    });
    expect(stay.receiptUrl).toBe(receiptUrlFor(doc.id));
    expect(doc).toMatchObject({ source: RECEIPT_SOURCE, kind: "invoice" });
    expect(await prisma.receiptUpload.findUnique({ where: { filename } })).toBeNull();
    expect(fs.existsSync(path.join(getUploadDir(), filename))).toBe(false);

    // Idempotent: a second run finds nothing left to move.
    expect((await migrateLegacyReceipts()).migrated).toBe(0);
  });

  it("clears the receiptUrl of the entry when its document is deleted", async () => {
    const doc = await receipt("delete");
    await prisma.flight.update({
      where: { id: flightId },
      data: { receiptUrl: receiptUrlFor(doc.id) },
    });

    await deleteDocument(userId, doc.id);

    expect(
      (await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).receiptUrl
    ).toBeNull();
  });

  it("accepts a document URL as a receiptUrl, and nothing that merely looks like one", () => {
    expect(
      receiptUrlValidator.safeParse(receiptUrlFor("0f8fad5b-d9cb-469f-a165-70867728950e")).success
    ).toBe(true);
    expect(receiptUrlValidator.safeParse("/api/v1/documents/../users/file").success).toBe(false);
  });
});

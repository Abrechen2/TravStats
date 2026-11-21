import fs from "fs";

import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";
import { hashPassword } from "../../../utils/password";
import { documentPath } from "../documentStore";
import {
  UNLINKED_TTL_DAYS,
  createDocument,
  linkDocuments,
  sweepDocuments,
  unlinkDocument,
  updateDocument,
} from "../documentService";
import { inLinkTransaction, repointLinks, setPrimaryLink } from "../documentLinks";
import { RECEIPT_SOURCE, reconcileReceiptDocuments } from "../receipts";

/**
 * Phase D1 of the document-links plan (docs/superpowers/specs/2026-11-21-document-links.md):
 * the links table is written by every filing path, the owner columns stay its
 * projection, and the lifecycle rules hold against a real database.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const PREFIX = `doc-links-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

const flightData = (userId: string): Prisma.FlightUncheckedCreateInput => ({
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

describe("document links (D1)", () => {
  let userId: string;
  let otherUserId: string;

  const linksOf = (documentId: string) =>
    prisma.documentLink.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
  const newFlight = async (uid = userId) =>
    (await prisma.flight.create({ data: flightData(uid) })).id;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `${PREFIX}-a`, passwordHash } })).id;
    otherUserId = (await prisma.user.create({ data: { username: `${PREFIX}-b`, passwordHash } }))
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

  it("files a new upload through ONE primary link, and the owner column mirrors it", async () => {
    const flightId = await newFlight();
    const { document } = await createDocument({
      userId,
      buffer: PDF("create"),
      entry: { type: "flight", id: flightId },
    });
    const links = await linksOf(document.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ flightId, role: "primary", provenance: "user" });
    expect(document).toMatchObject({ flightId, unlinkedAt: null });
    expect(document.linkedAt).toBeInstanceOf(Date);
  });

  it("unfiling removes the primary link and starts the clock; filing again clears it", async () => {
    const flightId = await newFlight();
    const { document } = await createDocument({
      userId,
      buffer: PDF("unfile"),
      entry: { type: "flight", id: flightId },
    });
    const unfiled = await unlinkDocument(userId, document.id);
    expect(await linksOf(document.id)).toHaveLength(0);
    expect(unfiled).toMatchObject({ flightId: null, linkedAt: null });
    expect(unfiled.unlinkedAt).toBeInstanceOf(Date);

    const tripId = (await prisma.trip.create({ data: { userId, name: "Relink" } })).id;
    const [relinked] = await linkDocuments(userId, [document.id], { type: "trip", id: tripId });
    expect(relinked).toMatchObject({ tripId, unlinkedAt: null });
    expect(await linksOf(document.id)).toMatchObject([{ tripId, role: "primary" }]);
  });

  it("keeps a rental's category on the rental link, and the old column follows it", async () => {
    const rental = await prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        pickupStationName: "FRA",
        pickupLat: 50.03,
        pickupLon: 8.56,
        pickupTimezone: "Europe/Berlin",
        returnStationName: "FRA",
        returnLat: 50.03,
        returnLon: 8.56,
        returnTimezone: "Europe/Berlin",
        pickupTime: new Date("2025-05-01T08:00:00Z"),
        returnTime: new Date("2025-05-03T08:00:00Z"),
      },
    });
    const { document } = await createDocument({
      userId,
      buffer: PDF("rental"),
      entry: { type: "rentalBooking", id: rental.id },
      rentalCategory: "pickup",
    });
    expect((await linksOf(document.id))[0].rentalCategory).toBe("pickup");
    const updated = await updateDocument(userId, document.id, { rentalCategory: "damage" });
    expect(updated.rentalCategory).toBe("damage");
    expect((await linksOf(document.id))[0].rentalCategory).toBe("damage");
  });

  it("refuses to link a stranger's entry, and writes nothing", async () => {
    const strangerFlight = await newFlight(otherUserId);
    const { document } = await createDocument({ userId, buffer: PDF("stranger") });
    await expect(
      inLinkTransaction((tx) =>
        setPrimaryLink(
          tx,
          userId,
          document.id,
          { type: "flight", id: strangerFlight },
          {
            provenance: "user",
          }
        )
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await linksOf(document.id)).toHaveLength(0);
  });

  it("deleting the primary entry keeps a document another entry still uses, filed there", async () => {
    const primaryFlight = await newFlight();
    const coveredFlight = await newFlight();
    const { document } = await createDocument({
      userId,
      buffer: PDF("covers"),
      entry: { type: "flight", id: primaryFlight },
    });
    await prisma.documentLink.create({
      data: {
        documentId: document.id,
        flightId: coveredFlight,
        role: "covers",
        provenance: "user",
      },
    });
    await prisma.flight.delete({ where: { id: primaryFlight } });
    const kept = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(kept).toMatchObject({ flightId: coveredFlight, unlinkedAt: null });
    expect(await linksOf(document.id)).toMatchObject([
      { flightId: coveredFlight, role: "primary" },
    ]);
  });

  it("a trip merge moves the links and folds a duplicate into one", async () => {
    const source = (await prisma.trip.create({ data: { userId, name: "Source" } })).id;
    const target = (await prisma.trip.create({ data: { userId, name: "Target" } })).id;
    const { document } = await createDocument({
      userId,
      buffer: PDF("merge"),
      entry: { type: "trip", id: source },
    });
    await prisma.documentLink.create({
      data: { documentId: document.id, tripId: target, role: "covers", provenance: "user" },
    });
    await inLinkTransaction((tx) =>
      repointLinks(tx, { type: "trip", ids: [source] }, { type: "trip", id: target })
    );
    expect(await linksOf(document.id)).toMatchObject([{ tripId: target, role: "primary" }]);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).tripId).toBe(
      target
    );
  });

  it("the sweep keeps a document that was filed after it was selected", async () => {
    const { document } = await createDocument({ userId, buffer: PDF("race") });
    await prisma.document.update({
      where: { id: document.id },
      data: { unlinkedAt: new Date(Date.now() - (UNLINKED_TTL_DAYS + 1) * DAY) },
    });
    const flightId = await newFlight();
    const realFindMany = prisma.document.findMany.bind(prisma.document);
    const spy = jest.spyOn(prisma.document, "findMany").mockImplementationOnce((async (
      args: Prisma.DocumentFindManyArgs
    ) => {
      const selected = await realFindMany(args);
      // Filed between the sweep's select and its delete.
      await linkDocuments(userId, [document.id], { type: "flight", id: flightId });
      return selected;
    }) as unknown as typeof prisma.document.findMany);
    try {
      await sweepDocuments(new Date(), async () => 0);
    } finally {
      spy.mockRestore();
    }
    const kept = await prisma.document.findUnique({ where: { id: document.id } });
    expect(kept).toMatchObject({ flightId });
    expect(await linksOf(document.id)).toHaveLength(1);
  });

  it("the receipt run never takes off a link the user made", async () => {
    const flightId = await newFlight();
    const { document } = await createDocument({
      userId,
      buffer: PDF("receipt-user"),
      source: RECEIPT_SOURCE,
      entry: { type: "flight", id: flightId },
    });
    // No `receiptUrl` names it — the run would once have unfiled it.
    await reconcileReceiptDocuments();
    expect(await linksOf(document.id)).toMatchObject([{ flightId, provenance: "user" }]);
  });

  it("the receipt run takes off its own link once nothing names the receipt", async () => {
    const flightId = await newFlight();
    const { document } = await createDocument({
      userId,
      buffer: PDF("receipt-run"),
      source: RECEIPT_SOURCE,
    });
    const url = `/api/v1/documents/${document.id}/file`;
    await prisma.flight.update({ where: { id: flightId }, data: { receiptUrl: url } });
    await reconcileReceiptDocuments();
    expect(await linksOf(document.id)).toMatchObject([{ flightId, provenance: "legacy" }]);

    await prisma.flight.update({ where: { id: flightId }, data: { receiptUrl: null } });
    await reconcileReceiptDocuments();
    expect(await linksOf(document.id)).toHaveLength(0);
    const unfiled = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(unfiled).toMatchObject({ flightId: null, linkedAt: null });
    expect(unfiled.unlinkedAt).toBeInstanceOf(Date);
  });
});

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";
import * as documents from "../../services/documents/documentService";
import { documentPath } from "../../services/documents/documentStore";

/**
 * A rental and its receipt are created together or not at all (forgejo#370).
 * The receipt used to be filed AFTER the rental had committed: when filing
 * failed the client got an error, the rental stayed, and the retry made a
 * duplicate (a rental has no client reference to dedupe on).
 */
describe("a rental create files its receipt in the same transaction", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `rental-receipt-${stamp}`, passwordHash: "unused" },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Elsewhere" } })).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rentalCreationLimiter.resetKey(`user:${userId}`);
  });
  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function receiptFiledElsewhereMeanwhile(): Promise<string> {
    const id = (
      await documents.createDocument({
        userId,
        buffer: Buffer.from(`%PDF-1.4\n% rental-${stamp}-${Math.random()}\n%%EOF`),
      })
    ).document.id;
    const real = documents.takeDocumentIds;
    jest.spyOn(documents, "takeDocumentIds").mockImplementation(async (user, body) => {
      const ids = await real(user, body);
      await prisma.document.update({ where: { id }, data: { tripId, linkedAt: new Date() } });
      return ids;
    });
    return id;
  }

  const rental = (over: Record<string, unknown> = {}) => ({
    provider: "Testcar",
    pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
    pickupLocal: "2026-08-10T10:00",
    returnLocal: "2026-08-14T10:00",
    ...over,
  });

  it("POST /rentals: a receipt that cannot be filed leaves no rental behind", async () => {
    const id = await receiptFiledElsewhereMeanwhile();
    const res = await request(app)
      .post("/api/v1/rentals")
      .set("Cookie", cookie)
      .send(rental({ documentIds: [id] }));
    expect(res.status).toBe(409);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
  });

  it("POST /rentals/import: a receipt that cannot be filed leaves no rental behind", async () => {
    const id = await receiptFiledElsewhereMeanwhile();
    const res = await request(app)
      .post("/api/v1/rentals/import")
      .set("Cookie", cookie)
      .send({
        kind: "confirmation",
        input: rental({ confirmationNumber: `RC-${stamp}` }),
        documentIds: [id],
      });
    expect(res.status).toBe(409);
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
  });

  it("files a receipt with the new rental", async () => {
    const id = (
      await documents.createDocument({
        userId,
        buffer: Buffer.from(`%PDF-1.4\n% ok-${stamp}\n%%EOF`),
      })
    ).document.id;
    const res = await request(app)
      .post("/api/v1/rentals")
      .set("Cookie", cookie)
      .send(rental({ documentIds: [id] }));
    expect(res.status).toBe(201);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.rentalBookingId).toBe(res.body.data.id);
  });
});

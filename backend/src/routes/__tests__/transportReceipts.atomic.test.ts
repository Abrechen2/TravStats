import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter, railCreationLimiter } from "../../middleware/rateLimit";
import * as documents from "../../services/documents/documentService";
import { documentPath } from "../../services/documents/documentStore";

/**
 * A rail or bus ride and its receipt are created together or not at all.
 * The receipt used to be filed AFTER the create had committed: when filing
 * failed, the ride existed without its receipt and the client-ref claim was
 * spent, so the outbox replay answered "already created" and never filed it.
 */
describe("a rail or bus create files its receipt in the same transaction", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `receipt-atomic-${stamp}`, passwordHash: "unused" },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Elsewhere" } })).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await railCreationLimiter.resetKey(`user:${userId}`);
    await busCreationLimiter.resetKey(`user:${userId}`);
  });
  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  /** The receipt passes the up-front check, then is filed with a trip before the create. */
  async function receiptFiledElsewhereMeanwhile(): Promise<string> {
    const id = (
      await documents.createDocument({
        userId,
        buffer: Buffer.from(`%PDF-1.4\n% receipt-${stamp}-${Math.random()}\n%%EOF`),
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

  it("rail: a receipt that cannot be filed leaves no ride behind", async () => {
    const id = await receiptFiledElsewhereMeanwhile();
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        departureStation: {
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" },
        departureLocal: "2025-03-01T08:00",
        arrivalLocal: "2025-03-01T08:40",
        documentIds: [id],
      });
    expect(res.status).toBe(409);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("bus: a receipt that cannot be filed leaves no ride behind", async () => {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: ["bus"], data: {} },
      update: { enabledDomains: ["bus"] },
    });
    const id = await receiptFiledElsewhereMeanwhile();
    const res = await request(app)
      .post("/api/v1/bus")
      .set("Cookie", cookie)
      .send({
        departureStation: { name: "Seoul", lat: 37.5048, lon: 127.0046, country: "KR" },
        arrivalStation: { name: "Sokcho", lat: 38.1911, lon: 128.5918, country: "KR" },
        departureLocal: "2026-09-20T09:00",
        arrivalLocal: "2026-09-20T11:20",
        documentIds: [id],
      });
    expect(res.status).toBe(409);
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(0);
  });

  it("files a receipt with the new ride", async () => {
    const id = (
      await documents.createDocument({
        userId,
        buffer: Buffer.from(`%PDF-1.4\n% ok-${stamp}\n%%EOF`),
      })
    ).document.id;
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        departureStation: {
          name: "Frankfurt (Main) Hbf",
          lat: 50.1071,
          lon: 8.6632,
          country: "DE",
        },
        arrivalStation: { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" },
        departureLocal: "2025-03-02T08:00",
        documentIds: [id],
      });
    expect(res.status).toBe(201);
    const filed = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(filed.railJourneyId).toBe(res.body.data.id);
    await prisma.railJourney.deleteMany({ where: { userId } });
  });
});

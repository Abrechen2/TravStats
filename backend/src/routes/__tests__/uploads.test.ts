import request from "supertest";
import fs from "fs";
import path from "path";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getUploadDir } from "../../middleware/upload";

/**
 * Regression coverage for the finding that receipts attached to a lodging
 * stay could be uploaded but never viewed or deleted again: the serve/delete
 * routes authorized a receipt ONLY via `prisma.flight.findFirst`, so any
 * receipt referenced solely by a `LodgingStay` 403/404'd for its own owner.
 */
describe("Uploads receipt authorization — cross-domain ownership", () => {
  let userId: string;
  let authCookie: string;
  let otherUserId: string;
  let otherAuthCookie: string;

  function writeTestReceiptFile(): string {
    const filename = `test-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    fs.writeFileSync(path.join(getUploadDir(), filename), "not-a-real-image-but-good-enough");
    return filename;
  }

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: { user: { username: { in: ["uploadstest", "uploadsother"] } } },
    });
    await prisma.lodging.deleteMany({
      where: { user: { username: { in: ["uploadstest", "uploadsother"] } } },
    });
    await prisma.flight.deleteMany({
      where: { user: { username: { in: ["uploadstest", "uploadsother"] } } },
    });
    await prisma.user.deleteMany({ where: { username: { in: ["uploadstest", "uploadsother"] } } });

    const u = await prisma.user.create({
      data: { username: "uploadstest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "uploadsother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherAuthCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("a receipt attached to a lodging stay", () => {
    let filename: string;
    let stayId: string;

    beforeEach(async () => {
      filename = writeTestReceiptFile();
      const lodging = await prisma.lodging.create({
        data: { userId, name: "Receipt Test Hotel" },
      });
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date("2024-05-01T00:00:00.000Z"),
          checkOut: new Date("2024-05-02T00:00:00.000Z"),
          receiptUrl: `/api/v1/uploads/receipts/${filename}`,
        },
      });
      stayId = stay.id;
    });

    it("can be fetched by its owner", async () => {
      const res = await request(app)
        .get(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
    });

    it("cannot be fetched by a different user (404)", async () => {
      const res = await request(app)
        .get(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", otherAuthCookie);
      expect(res.status).toBe(404);
    });

    it("cannot be fetched unauthenticated", async () => {
      const res = await request(app).get(`/api/v1/uploads/receipts/${filename}`);
      expect(res.status).toBe(401);
    });

    it("cannot be deleted by a different user (404), and the file survives", async () => {
      const res = await request(app)
        .delete(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", otherAuthCookie);
      expect(res.status).toBe(404);
      expect(fs.existsSync(path.join(getUploadDir(), filename))).toBe(true);

      const stillThere = await prisma.lodgingStay.findUnique({ where: { id: stayId } });
      expect(stillThere?.receiptUrl).toBe(`/api/v1/uploads/receipts/${filename}`);
    });

    it("can be deleted by its owner, clearing the stay's receiptUrl", async () => {
      const res = await request(app)
        .delete(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedStay = await prisma.lodgingStay.findUnique({ where: { id: stayId } });
      expect(updatedStay?.receiptUrl).toBeNull();
    });
  });

  describe("a receipt attached to a flight (existing behaviour, unchanged)", () => {
    let filename: string;
    let flightId: string;

    beforeEach(async () => {
      filename = writeTestReceiptFile();
      const flight = await prisma.flight.create({
        data: {
          userId,
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 41.2974,
          arrLon: 2.0833,
          status: "flown",
          departureTime: new Date("2024-07-01T10:00:00.000Z"),
          arrivalTime: new Date("2024-07-01T12:00:00.000Z"),
          receiptUrl: `/api/v1/uploads/receipts/${filename}`,
        },
      });
      flightId = flight.id;
    });

    it("can still be fetched and deleted by its owner", async () => {
      const getRes = await request(app)
        .get(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", authCookie);
      expect(getRes.status).toBe(200);

      const delRes = await request(app)
        .delete(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", authCookie);
      expect(delRes.status).toBe(200);

      const updatedFlight = await prisma.flight.findUnique({ where: { id: flightId } });
      expect(updatedFlight?.receiptUrl).toBeNull();
    });

    it("cannot be fetched or deleted by a different user", async () => {
      const getRes = await request(app)
        .get(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", otherAuthCookie);
      expect(getRes.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/v1/uploads/receipts/${filename}`)
        .set("Cookie", otherAuthCookie);
      expect(delRes.status).toBe(404);
    });
  });

  it("returns 404 for a filename with no owning flight or lodging stay at all", async () => {
    const filename = writeTestReceiptFile();
    const res = await request(app)
      .get(`/api/v1/uploads/receipts/${filename}`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });
});

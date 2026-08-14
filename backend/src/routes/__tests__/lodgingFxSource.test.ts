import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/resolver";

/**
 * Which provider produced a stored conversion, kept on the row.
 *
 * A rate of 0.0848 tells you nothing about whether the ECB published it or
 * the user typed it in, and the UI must never present the second as the
 * first. The column is what makes that distinguishable AFTER the fact.
 */
describe("fx provenance on a stay", () => {
  let authCookie: string;
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "fxsource_test" } });
    const user = await prisma.user.create({
      data: { username: "fxsource_test", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Provenance" } });
    lodgingId = lodging.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const createStay = async (body: Record<string, unknown>) =>
    request(app).post(`/api/v1/lodging/${lodgingId}/stays`).set("Cookie", authCookie).send(body);

  it("records which source produced a stored conversion", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 97.2,
      rate: 0.0848,
      rateDate: "2024-09-17",
      source: "ecb",
    });
    const res = await createStay({
      checkIn: "2024-09-17T15:00:00.000Z",
      checkOut: "2024-09-18T11:00:00.000Z",
      totalPrice: 1146.5,
      currency: "NOK",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fxSource).toBe("ecb");
  });

  it("marks a CDN conversion as the CDN's, not the ECB's", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 201.57,
      rate: 0.017284254,
      rateDate: "2026-03-04",
      source: "cdn",
    });
    const res = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-08T11:00:00.000Z",
      totalPrice: 11662,
      currency: "EGP",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fxSource).toBe("cdn");
    expect(res.body.data.totalPriceBase).toBeCloseTo(201.57, 2);
  });

  it("leaves it null when nothing could be converted, and keeps the amount", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
    const res = await createStay({
      checkIn: "2023-04-30T15:00:00.000Z",
      checkOut: "2023-05-03T11:00:00.000Z",
      totalPrice: 11662,
      currency: "AED",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalPriceBase).toBeNull();
    expect(res.body.data.fxSource).toBeNull();
    // The amount itself survives in its own currency — that is the whole point.
    expect(res.body.data.totalPrice).toBe(11662);
    expect(res.body.data.currency).toBe("AED");
  });

  it("clears the source again when the price is removed", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 100,
      rate: 1,
      rateDate: "2025-01-01",
      source: "ecb",
    });
    const created = await createStay({
      checkIn: "2025-01-01T15:00:00.000Z",
      checkOut: "2025-01-02T11:00:00.000Z",
      totalPrice: 100,
      currency: "EUR",
    });
    expect(created.body.data.fxSource).toBe("ecb");

    const patched = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}/stays/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ totalPrice: null });
    expect(patched.status).toBe(200);
    expect(patched.body.data.fxSource).toBeNull();
  });
});

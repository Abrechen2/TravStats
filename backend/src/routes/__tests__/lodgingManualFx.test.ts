import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/resolver";

/**
 * A rate the user typed in.
 *
 * It exists for the gap — a currency and day no provider covers — and NOT for
 * disagreeing with the ECB. So it is refused where an automatic rate exists,
 * and whatever it produces is marked as the user's own, never as official.
 */
describe("a rate the user supplied", () => {
  let authCookie: string;
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "manualfx_test" } });
    const user = await prisma.user.create({
      data: { username: "manualfx_test", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Manual" } });
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

  const createStay = (body: Record<string, unknown>) =>
    request(app).post(`/api/v1/lodging/${lodgingId}/stays`).set("Cookie", authCookie).send(body);

  const noRate = () => jest.spyOn(fx, "convertToBase").mockResolvedValue(null);

  it("converts and is marked as the user's own", async () => {
    noRate();
    const res = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-08T11:00:00.000Z",
      totalPrice: 11662,
      currency: "EGP",
      manualFxRate: 0.01955,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalPriceBase).toBeCloseTo(228.0, 1);
    expect(res.body.data.fxSource).toBe("manual");
    expect(res.body.data.fxRate).toBeCloseTo(0.01955, 5);
    expect(res.body.data.fxBaseCurrency).toBe("EUR");
  });

  it("is refused where an automatic rate exists, so nobody overrides the ECB by accident", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 8.48,
      rate: 0.0848,
      rateDate: "2024-09-17",
      source: "ecb",
    });
    const res = await createStay({
      checkIn: "2024-09-17T15:00:00.000Z",
      checkOut: "2024-09-18T11:00:00.000Z",
      totalPrice: 100,
      currency: "NOK",
      manualFxRate: 9.9,
    });
    expect(res.status).toBe(400);
  });

  it("must be a positive number", async () => {
    noRate();
    const zero = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-05T11:00:00.000Z",
      totalPrice: 100,
      currency: "EGP",
      manualFxRate: 0,
    });
    expect(zero.status).toBe(400);
    const negative = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-05T11:00:00.000Z",
      totalPrice: 100,
      currency: "EGP",
      manualFxRate: -1,
    });
    expect(negative.status).toBe(400);
  });

  it("can be added later to a stay that was saved without one", async () => {
    // The ordinary path: the user saves the stay, sees "kein Kurs", and types
    // a rate afterwards. Nothing about price, currency or date changes — so a
    // PATCH that only re-runs FX when those change would ignore the rate.
    noRate();
    const created = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-08T11:00:00.000Z",
      totalPrice: 11662,
      currency: "EGP",
    });
    expect(created.body.data.fxSource).toBeNull();

    const patched = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}/stays/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ manualFxRate: 0.01955 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.fxSource).toBe("manual");
    expect(patched.body.data.totalPriceBase).toBeCloseTo(228.0, 1);
  });

  it("can be taken back, leaving the stay honestly unconverted", async () => {
    noRate();
    const created = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-08T11:00:00.000Z",
      totalPrice: 11662,
      currency: "EGP",
      manualFxRate: 0.01955,
    });
    expect(created.body.data.fxSource).toBe("manual");

    const cleared = await request(app)
      .patch(`/api/v1/lodging/${lodgingId}/stays/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ manualFxRate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.fxSource).toBeNull();
    expect(cleared.body.data.totalPriceBase).toBeNull();
    // The amount itself is untouched — only the conversion goes.
    expect(cleared.body.data.totalPrice).toBe(11662);
  });

  it("is not stored as a column of its own", async () => {
    // `manualFxRate` is a request field, not a stay field: it produces fxRate
    // + fxSource. Spreading it into the write would be a Prisma unknown-arg
    // error, so this pins that it is stripped.
    noRate();
    const res = await createStay({
      checkIn: "2026-03-04T15:00:00.000Z",
      checkOut: "2026-03-05T11:00:00.000Z",
      totalPrice: 100,
      currency: "EGP",
      manualFxRate: 0.02,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.manualFxRate).toBeUndefined();
  });
});

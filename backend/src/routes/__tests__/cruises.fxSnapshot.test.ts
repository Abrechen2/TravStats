import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/resolver";

/**
 * `Cruise` was the ONLY priced model without an FX snapshot — see the
 * `cruise_base_currency` migration and `services/trip/tripCostSuperlative.ts`
 * for what that let happen (a large-face-value foreign currency beating a
 * small-face-value euro trip, compared unconverted). This pins the write
 * path added to `routes/cruises.ts`, mirroring the same-shaped tests for
 * `Flight` (`flightsBatch.parity.test.ts`) and `LodgingStay`
 * (`lodgingManualFx.test.ts`).
 */
describe("cruise FX snapshot (#267 parity)", () => {
  let authCookie: string;
  let userId: string;
  let portId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "cruise_fx_test" } });
    const user = await prisma.user.create({
      data: { username: "cruise_fx_test", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    const port = await prisma.port.findFirst({ where: { isUserAdded: false } });
    if (!port) throw new Error("Missing seeded port — run seeders first");
    portId = port.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const createCruise = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        departurePortId: portId,
        arrivalPortId: portId,
        startDate: "2026-08-01T12:00:00Z",
        endDate: "2026-08-08T10:00:00Z",
        status: "scheduled",
        ...body,
      });

  it("stores a base amount and the rate for a non-base currency", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 920,
      rate: 0.92,
      rateDate: "2026-08-01",
      source: "ecb",
    });
    const res = await createCruise({ price: 1000, currency: "USD" });
    expect(res.status).toBe(201);
    expect(res.body.data.priceBase).toBe(920);
    expect(res.body.data.fxRate).toBe(0.92);
    expect(res.body.data.fxBaseCurrency).toBe("EUR");
    expect(res.body.data.fxSource).toBe("ecb");
  });

  it("stores rate 1 for an amount already in the base currency", async () => {
    // No mock: EUR -> EUR short-circuits in every provider (frankfurter.ts,
    // currencyApiCdn.ts) without a network call.
    const res = await createCruise({ price: 250, currency: "EUR" });
    expect(res.status).toBe(201);
    expect(res.body.data.priceBase).toBe(250);
    expect(res.body.data.fxRate).toBe(1);
    expect(res.body.data.fxBaseCurrency).toBe("EUR");
  });

  it("stores nulls for a cruise with no price", async () => {
    const res = await createCruise({});
    expect(res.status).toBe(201);
    expect(res.body.data.priceBase).toBeNull();
    expect(res.body.data.fxRate).toBeNull();
    expect(res.body.data.fxRateDate).toBeNull();
    expect(res.body.data.fxBaseCurrency).toBeNull();
    expect(res.body.data.fxSource).toBeNull();
  });

  it("recomputes the snapshot on a PATCH that changes the price", async () => {
    const created = await createCruise({ price: 100, currency: "EUR" });
    expect(created.body.data.priceBase).toBe(100);

    jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 184,
      rate: 0.92,
      rateDate: "2026-08-01",
      source: "ecb",
    });
    const patched = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ price: 200, currency: "USD" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.priceBase).toBe(184);
    expect(patched.body.data.fxRate).toBe(0.92);
  });

  it("clears the snapshot when the price is removed on a PATCH", async () => {
    const created = await createCruise({ price: 100, currency: "EUR" });
    expect(created.body.data.priceBase).toBe(100);

    const patched = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ price: null });
    expect(patched.status).toBe(200);
    expect(patched.body.data.priceBase).toBeNull();
    expect(patched.body.data.fxRate).toBeNull();
  });

  it("leaves the snapshot untouched on a PATCH that never mentions price/currency/startDate", async () => {
    const created = await createCruise({ price: 100, currency: "EUR" });
    expect(created.body.data.priceBase).toBe(100);

    const patched = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ notes: "unrelated edit" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.priceBase).toBe(100);
    expect(patched.body.data.fxRate).toBe(1);
  });
});

import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

/**
 * The bookings that started this work, driven through the REAL chain.
 *
 * Only the two providers are mocked — the resolver, the admin switch, the
 * route, the schema and the database are the actual ones, so this fails if
 * any link stops carrying the answer through.
 *
 * The three cases are the three states, taken from the owner's own
 * confirmations and the live measurements of 2026-08-13:
 *   NOK 2024-09-17  the ECB publishes it
 *   EGP 2026-03-04  the ECB does not; the CDN does (0.017284254)
 *   AED 2023-04-30  neither does — the CDN's history starts April 2024
 */
jest.mock("../services/fx/frankfurter", () => ({
  getRate: jest.fn(),
}));
jest.mock("../services/fx/currencyApiCdn", () => ({
  getCdnRate: jest.fn(),
}));

const ecb = jest.requireMock("../services/fx/frankfurter").getRate as jest.Mock;
const cdn = jest.requireMock("../services/fx/currencyApiCdn").getCdnRate as jest.Mock;

describe("the bookings that could not record a price", () => {
  let authCookie: string;
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "currency_e2e" } });
    const user = await prisma.user.create({
      data: { username: "currency_e2e", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel End To End" } });
    lodgingId = lodging.id;

    // The CDN fallback must be ON for the EGP case — that is the instance
    // default, and this pins that the case depends on it.
    const settings = await prisma.adminSettings.findFirst();
    if (settings) {
      await prisma.adminSettings.update({
        where: { id: settings.id },
        data: { fxCdnFallbackEnabled: true },
      });
    } else {
      await prisma.adminSettings.create({ data: { fxCdnFallbackEnabled: true } });
    }
  });

  beforeEach(() => {
    ecb.mockReset();
    cdn.mockReset();
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

  it("converts NOK on 2024-09-17 through the ECB", async () => {
    ecb.mockResolvedValue({ rate: 0.08481, source: "ecb" });
    const res = await createStay({
      checkIn: "2024-09-17T14:00:00.000Z",
      checkOut: "2024-09-19T10:00:00.000Z",
      totalPrice: 3380,
      currency: "NOK",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fxSource).toBe("ecb");
    expect(res.body.data.totalPriceBase).toBeCloseTo(286.66, 2);
    expect(cdn).not.toHaveBeenCalled(); // the ECB answered; jsDelivr is never asked
  });

  it("converts EGP on 2026-03-04 through the CDN", async () => {
    ecb.mockResolvedValue(null);
    cdn.mockResolvedValue({ rate: 0.017284254, source: "cdn" });
    const res = await createStay({
      checkIn: "2026-03-04T14:00:00.000Z",
      checkOut: "2026-03-08T10:00:00.000Z",
      totalPrice: 11662,
      currency: "EGP",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fxSource).toBe("cdn");
    expect(res.body.data.totalPriceBase).toBeCloseTo(201.57, 2);
  });

  it("marks AED on 2023-04-30, which no source reaches", async () => {
    ecb.mockResolvedValue(null);
    cdn.mockResolvedValue(null); // before the CDN's history begins
    const res = await createStay({
      checkIn: "2023-04-30T14:00:00.000Z",
      checkOut: "2023-05-03T10:00:00.000Z",
      totalPrice: 11662,
      currency: "AED",
    });
    expect(res.status).toBe(201);
    // The amount survives in its own currency. Before this work it could not
    // be entered at all; the version before that stored it as EUR 11,662.
    expect(res.body.data.totalPrice).toBe(11662);
    expect(res.body.data.currency).toBe("AED");
    expect(res.body.data.totalPriceBase).toBeNull();
    expect(res.body.data.fxSource).toBeNull();
  });

  it("lets the user close that last gap with a rate of their own", async () => {
    ecb.mockResolvedValue(null);
    cdn.mockResolvedValue(null);
    const res = await createStay({
      checkIn: "2023-04-30T14:00:00.000Z",
      checkOut: "2023-05-03T10:00:00.000Z",
      totalPrice: 11662,
      currency: "AED",
      manualFxRate: 0.2489,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.fxSource).toBe("manual");
    expect(res.body.data.totalPriceBase).toBeCloseTo(2902.67, 2);
  });

  it("an admin who switched the CDN off keeps the ECB and nothing else", async () => {
    const settings = await prisma.adminSettings.findFirst();
    await prisma.adminSettings.update({
      where: { id: settings!.id },
      data: { fxCdnFallbackEnabled: false },
    });
    try {
      ecb.mockResolvedValue(null);
      cdn.mockResolvedValue({ rate: 0.017284254, source: "cdn" });
      const res = await createStay({
        checkIn: "2026-03-04T14:00:00.000Z",
        checkOut: "2026-03-05T10:00:00.000Z",
        totalPrice: 100,
        currency: "EGP",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.fxSource).toBeNull();
      expect(cdn).not.toHaveBeenCalled();
    } finally {
      await prisma.adminSettings.update({
        where: { id: settings!.id },
        data: { fxCdnFallbackEnabled: true },
      });
    }
  });
});

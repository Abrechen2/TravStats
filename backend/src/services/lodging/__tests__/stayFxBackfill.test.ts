import { prisma } from "../../../db";
import * as fx from "../../fx/resolver";
import { hashPassword } from "../../../utils/password";
import { backfillMissingStayFx } from "../stayFxBackfill";
import { lodgingBaseAmount, isUnconvertedSpend } from "../../../shared/lodgingSpendBase";

/**
 * Browser acceptance 2026-09-26: a USD stay whose rate lookup failed at write
 * time said "kein Kurs" until someone happened to re-save it — the rate for
 * its day existed all along. The backfill takes the missing snapshot, and
 * touches nothing else. All FX lookups are mocked; no test reaches a network.
 */

const USERNAME = "stayfxbackfill";

describe("backfillMissingStayFx", () => {
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Backfill Hotel", type: "hotel" },
    });
    lodgingId = lodging.id;
  });

  beforeEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const stay = (data: Record<string, unknown>) =>
    prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId,
        checkIn: new Date("2024-06-01T00:00:00Z"),
        checkOut: new Date("2024-06-03T00:00:00Z"),
        status: "completed",
        ...data,
      },
    });

  const row = (id: string) => prisma.lodgingStay.findUniqueOrThrow({ where: { id } });

  it("takes the missing snapshot of a dated foreign-currency stay", async () => {
    const convert = jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 276.5,
      rate: 0.9217,
      rateDate: "2024-06-01",
      source: "ecb",
    });
    const usd = await stay({ totalPrice: 300, currency: "USD" });
    // Before: the rule every total and the card follow calls it unconverted.
    expect(isUnconvertedSpend(await row(usd.id), "EUR")).toBe(true);

    const result = await backfillMissingStayFx();

    expect(result).toMatchObject({ checked: 1, filled: 1, stillMissing: 0 });
    expect(convert).toHaveBeenCalledWith(300, "USD", "EUR", expect.any(Date));
    const after = await row(usd.id);
    expect(after).toMatchObject({
      totalPriceBase: 276.5,
      fxRate: 0.9217,
      fxBaseCurrency: "EUR",
      fxSource: "ecb",
    });
    expect(lodgingBaseAmount(after, "EUR")).toBe(276.5);
  });

  it("leaves a stay whose lookup fails again exactly as it was", async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
    const usd = await stay({ totalPrice: 300, currency: "USD" });

    const result = await backfillMissingStayFx();

    expect(result).toMatchObject({ checked: 1, filled: 0, stillMissing: 1 });
    expect((await row(usd.id)).totalPriceBase).toBeNull();
  });

  it("never touches a stay that has a snapshot, a base-currency price or no date", async () => {
    const convert = jest.spyOn(fx, "convertToBase").mockResolvedValue({
      baseAmount: 1,
      rate: 1,
      rateDate: "2024-06-01",
      source: "ecb",
    });
    const kept = await stay({
      totalPrice: 300,
      currency: "USD",
      totalPriceBase: 250,
      fxRate: 0.8333,
      fxRateDate: new Date("2024-06-01T00:00:00Z"),
      fxBaseCurrency: "EUR",
      fxSource: "manual",
    });
    await stay({ totalPrice: 210, currency: "EUR" });
    await stay({ totalPrice: 90, currency: "USD", checkIn: null, checkOut: null });

    const result = await backfillMissingStayFx();

    expect(result).toMatchObject({ checked: 0, filled: 0 });
    expect(convert).not.toHaveBeenCalled();
    expect(await row(kept.id)).toMatchObject({ totalPriceBase: 250, fxSource: "manual" });
  });
});

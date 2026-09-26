import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { BULK_CITIES } from "../seedDemo/bulk";
import { seedBulk } from "../seedDemo/seedBulk";
import { SEED_FX_RATES } from "../seedDemo/stayFx";

describe("seedBulk", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedBulkUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedBulkUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("writes one stay per city, every place, and two lists with members", async () => {
    const result = await seedBulk(userId);
    expect(result.stays).toBe(BULK_CITIES.length);
    expect(result.places).toBe(BULK_CITIES.reduce((n, c) => n + c.places.length, 0));
    expect(result.lists).toBe(2);
    const lists = await prisma.placeList.findMany({
      where: { userId },
      include: { entries: true },
    });
    for (const list of lists) {
      if (list.entries.length === 0) throw new Error(`${list.name}: expected at least one entry`);
    }
    // Unattached: bulk rows belong to no trip.
    expect(await prisma.lodgingStay.count({ where: { userId, tripId: { not: null } } })).toBe(0);
  });

  /**
   * Finding B4 of the independent review of 2026-09-17: a priced stay with no
   * FX snapshot into the current base currency is counted as "not converted"
   * and never reaches the base total (utils/lodgingStats/money.ts). Every
   * seeded stay was in that state, so the money tab showed nothing.
   */
  it("snapshots every priced stay it has a rate for, and abstains for the rest", async () => {
    const stays = await prisma.lodgingStay.findMany({ where: { userId } });
    expect(stays.length).toBeGreaterThan(0);
    const converted = stays.filter((s) => s.totalPriceBase !== null);
    const unconverted = stays.filter((s) => s.totalPrice !== null && s.totalPriceBase === null);

    expect(converted.length).toBeGreaterThan(0);
    for (const stay of converted) {
      expect(stay.fxRate).not.toBeNull();
      expect(stay.fxRateDate).not.toBeNull();
      expect(stay.fxBaseCurrency).toBe("EUR");
      // Never "ecb": a rate this seed invented must not be labelled as the
      // European Central Bank's.
      expect(stay.fxSource).toBe("manual");
    }

    // Kept on purpose, so the "not converted" hint has a real example: the
    // currencies `SEED_FX_RATES` deliberately has no rate for.
    expect(unconverted.length).toBeGreaterThan(0);
    for (const stay of unconverted) {
      expect(SEED_FX_RATES[stay.currency]).toBeUndefined();
      expect(stay.fxRate).toBeNull();
      expect(stay.fxBaseCurrency).toBeNull();
    }
  });

  /**
   * The bulk stays carried fixed calendar years (2017–2025), so every year the
   * demo aged: its newest stay drifted further into the past each January. They
   * are relative to the current year now; seeded "in 2040", the newest stay is
   * in 2039 and none is older than nine years.
   */
  it("places every stay relative to the year it is seeded in", async () => {
    await prisma.user.deleteMany({ where: { username: "seedBulkFutureUser" } });
    const future = await prisma.user.create({
      data: { username: "seedBulkFutureUser", passwordHash: "x" },
    });
    try {
      await seedBulk(future.id, new Date("2040-07-01T00:00:00Z"));
      const stays = await prisma.lodgingStay.findMany({ where: { userId: future.id } });
      const years = stays.map((s) => s.checkIn.getUTCFullYear());
      expect(Math.max(...years)).toBe(2039);
      expect(Math.min(...years)).toBeGreaterThanOrEqual(2031);
    } finally {
      await prisma.user.deleteMany({ where: { id: future.id } });
    }
  });
});

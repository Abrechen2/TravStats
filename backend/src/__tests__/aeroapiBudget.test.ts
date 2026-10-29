/**
 * The AeroAPI monthly budget guard and rate limit (forgejo#409), against the
 * real database: the point of the guard is that the month's spending is
 * persisted and reserved atomically, which a mock cannot show.
 */
import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

import { prisma } from "../db";
import {
  AEROAPI_COST_MILLI_USD,
  AEROAPI_RATE_LIMIT_PER_MINUTE,
  __resetAeroapiRateForTests,
  acquireRateSlot,
  budgetMilliUsd,
  getAeroapiUsage,
  requestAeroapiCall,
  utcMonthKey,
} from "../services/aeroapiBudget";
import { ensureAdminSettingsRow } from "../services/adminSettingsRow";

const MAY = new Date("2026-05-15T12:00:00Z");
const JUNE = new Date("2026-06-01T00:00:01Z");

async function setTier(
  tier: "personal" | "personal_feeder" | "custom",
  customBudgetUsd: number | null = null
) {
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: { aeroapiTier: tier, aeroapiCustomBudgetUsd: customBudgetUsd },
  });
}

describe("AeroAPI budget guard", () => {
  let before: { aeroapiTier: string; aeroapiCustomBudgetUsd: number | null };

  beforeEach(async () => {
    const id = await ensureAdminSettingsRow();
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id } });
    before ??= { aeroapiTier: row.aeroapiTier, aeroapiCustomBudgetUsd: row.aeroapiCustomBudgetUsd };
    await prisma.aeroapiUsage.deleteMany();
    __resetAeroapiRateForTests();
    await setTier("personal");
  });

  afterAll(async () => {
    await prisma.aeroapiUsage.deleteMany();
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: before,
    });
  });

  it("maps each tier to its monthly budget and a custom tier without a number to none", () => {
    expect(budgetMilliUsd({ tier: "personal", customBudgetUsd: null })).toBe(5000);
    expect(budgetMilliUsd({ tier: "personal_feeder", customBudgetUsd: null })).toBe(10000);
    expect(budgetMilliUsd({ tier: "custom", customBudgetUsd: 12.5 })).toBe(12500);
    expect(budgetMilliUsd({ tier: "custom", customBudgetUsd: null })).toBe(0);
  });

  it("refuses a call that would pass the budget and sends nothing (budget reached ⇒ no call)", async () => {
    await setTier("custom", 0.02); // two track calls' worth
    const cost = AEROAPI_COST_MILLI_USD.track;
    expect((await requestAeroapiCall("track", { now: MAY })).ok).toBe(true);
    expect((await requestAeroapiCall("track", { now: MAY })).ok).toBe(true);

    const third = await requestAeroapiCall("track", { now: MAY });

    expect(third).toEqual({ ok: false, reason: "budget" });
    const usage = await getAeroapiUsage(MAY);
    expect(usage.spentUsd).toBe((2 * cost) / 1000);
    expect(usage.calls).toBe(2);
    expect(usage.exhausted).toBe(true);
  });

  it("never lets concurrent callers spend past the budget", async () => {
    await setTier("custom", 0.05); // ten flights calls at 5 milli-dollars
    const gates = await Promise.all(
      Array.from({ length: 14 }, () => requestAeroapiCall("flights", { now: MAY }))
    );
    expect(gates.filter((g) => g.ok)).toHaveLength(10);
    expect((await getAeroapiUsage(MAY)).spentUsd).toBe(0.05);
  });

  it("starts a fresh budget in a new UTC month and keeps the old month's figure", async () => {
    await setTier("custom", 0.005);
    expect((await requestAeroapiCall("flights", { now: MAY })).ok).toBe(true);
    expect((await requestAeroapiCall("flights", { now: MAY })).ok).toBe(false);

    expect((await requestAeroapiCall("flights", { now: JUNE })).ok).toBe(true);

    expect((await getAeroapiUsage(JUNE)).spentUsd).toBe(0.005);
    expect((await getAeroapiUsage(MAY)).spentUsd).toBe(0.005);
    expect(utcMonthKey(new Date("2026-05-31T23:59:59Z"))).toBe("2026-05");
    expect(utcMonthKey(JUNE)).toBe("2026-06");
  });

  it("remembers the month's spending across a restart (it is in the database, not in memory)", async () => {
    await requestAeroapiCall("track", { now: MAY });
    __resetAeroapiRateForTests(); // everything in memory is gone

    expect((await getAeroapiUsage(MAY)).spentUsd).toBe(AEROAPI_COST_MILLI_USD.track / 1000);
  });

  it("gives a reserved cost back on release", async () => {
    const gate = await requestAeroapiCall("track", { now: MAY });
    if (!gate.ok) throw new Error("expected a gate");
    await gate.release();

    const usage = await getAeroapiUsage(MAY);
    expect(usage.spentUsd).toBe(0);
    expect(usage.calls).toBe(0);
  });

  it("refuses everything for a custom tier that has no budget instead of treating it as unlimited", async () => {
    await setTier("custom", null);
    expect(await requestAeroapiCall("flights", { now: MAY })).toEqual({
      ok: false,
      reason: "budget",
    });
  });

  it("answers rate_limit, and spends nothing, past ten result sets in a minute", async () => {
    await setTier("personal_feeder");
    for (let i = 0; i < AEROAPI_RATE_LIMIT_PER_MINUTE; i++) {
      expect((await requestAeroapiCall("flights", { now: MAY })).ok).toBe(true);
    }
    const spentBefore = (await getAeroapiUsage(MAY)).spentUsd;

    const eleventh = await requestAeroapiCall("flights", { now: MAY });

    expect(eleventh).toEqual({ ok: false, reason: "rate_limit" });
    expect((await getAeroapiUsage(MAY)).spentUsd).toBe(spentBefore);
  });
});

describe("AeroAPI rate limit", () => {
  beforeEach(() => {
    __resetAeroapiRateForTests();
    jest.useFakeTimers();
  });
  afterAll(() => jest.useRealTimers());

  it("waits for the oldest slot to age out when that fits the patience, and not otherwise", async () => {
    for (let i = 0; i < AEROAPI_RATE_LIMIT_PER_MINUTE; i++) {
      expect(await acquireRateSlot(0)).toBe(true);
    }
    expect(await acquireRateSlot(1000)).toBe(false);

    const waiting = acquireRateSlot(61_000);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(await waiting).toBe(true);
  });
});

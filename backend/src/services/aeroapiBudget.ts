/**
 * FlightAware AeroAPI: the monthly budget guard and the rate limit (forgejo#409).
 *
 * AeroAPI bills per RESULT SET, not per request, and the free monthly credit is
 * small ($5 Personal, up to $10 for ADS-B feeder hosts). A guard that only logs
 * would let a bulk refresh run the credit out and bill a card. So every call
 * reserves its cost here BEFORE it goes out, in one conditional upsert on the
 * month's row: a restart cannot forget the month's spending and two concurrent
 * callers cannot both squeeze under the last cent.
 *
 * The month is the UTC calendar month; FlightAware's own period is not
 * documented to the hour, so a call near midnight on the 1st may be counted
 * into the neighbouring month — the guard errs on neither side by design, it
 * is a budget, not an invoice.
 */

import { prisma } from "../db";
import { decryptApiKey } from "../utils/encryption";
import logger from "../utils/logger";

export const AEROAPI_TIERS = ["personal", "personal_feeder", "custom"] as const;
export type AeroapiTier = (typeof AEROAPI_TIERS)[number];

/** Whole milli-dollars: $5.000 is 5000. */
export const TIER_BUDGET_MILLI_USD: Readonly<Record<Exclude<AeroapiTier, "custom">, number>> = {
  personal: 5_000,
  personal_feeder: 10_000,
};

/**
 * Cost of ONE call, in milli-dollars. FlightAware prices AeroAPI per result
 * set returned (https://www.flightaware.com/aeroapi/portal/#pricing): a
 * `/flights/{ident}` page of up to 15 flights is one result set, a track is
 * one. The figures below are what the price list showed on 2026-10-29 and are
 * UNVERIFIED until a real invoice is compared with the counter in the admin
 * card — adjust them here, nowhere else.
 */
export const AEROAPI_COST_MILLI_USD = {
  /** GET /flights/{ident} — status of a flight number. */
  flights: 5,
  /** GET /flights/{fa_flight_id}/track — the recorded positions. */
  track: 10,
} as const;
export type AeroapiCallKind = keyof typeof AEROAPI_COST_MILLI_USD;

/** AeroAPI Personal: 10 result sets per minute. */
export const AEROAPI_RATE_LIMIT_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

export type AeroapiGateRefusal = "budget" | "rate_limit";

export type AeroapiGate =
  | { ok: true; cost: number; release: () => Promise<void> }
  | { ok: false; reason: AeroapiGateRefusal };

export interface AeroapiBudgetSettings {
  tier: AeroapiTier;
  customBudgetUsd: number | null;
}

/** `YYYY-MM` of the UTC calendar month containing `at`. */
export function utcMonthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** The monthly budget in milli-dollars. A custom tier without a number has none: 0, never "unlimited". */
export function budgetMilliUsd(settings: AeroapiBudgetSettings): number {
  if (settings.tier === "custom") {
    const usd = settings.customBudgetUsd;
    return usd !== null && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1000) : 0;
  }
  return TIER_BUDGET_MILLI_USD[settings.tier] ?? TIER_BUDGET_MILLI_USD.personal;
}

export async function readBudgetSettings(): Promise<AeroapiBudgetSettings> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { aeroapiTier: true, aeroapiCustomBudgetUsd: true },
  });
  const tier = AEROAPI_TIERS.find((t) => t === row?.aeroapiTier) ?? "personal";
  return { tier, customBudgetUsd: row?.aeroapiCustomBudgetUsd ?? null };
}

// ---- rate limit ------------------------------------------------------------

/** One window per FlightAware account: the instance's, and each user's own key. */
const INSTANCE_BUCKET = "instance";
const recentCallsByBucket = new Map<string, number[]>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Takes one of the minute's result-set slots. Waits for a free one when that
 * takes no longer than `maxWaitMs`; otherwise answers false at once — a user
 * waiting on a lookup must not be held for a minute, the chain falls through.
 */
export async function acquireRateSlot(
  maxWaitMs: number,
  bucket: string = INSTANCE_BUCKET
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  const recentCalls = recentCallsByBucket.get(bucket) ?? [];
  recentCallsByBucket.set(bucket, recentCalls);
  for (;;) {
    const now = Date.now();
    while (recentCalls.length > 0 && now - recentCalls[0] >= RATE_WINDOW_MS) recentCalls.shift();
    if (recentCalls.length < AEROAPI_RATE_LIMIT_PER_MINUTE) {
      recentCalls.push(now);
      return true;
    }
    const wait = recentCalls[0] + RATE_WINDOW_MS - now;
    if (now + wait > deadline) return false;
    await sleep(wait);
  }
}

/** Does this user's own AeroAPI key (not the instance's) serve their calls? Mirrors `getApiKey`'s order. */
export async function usesOwnAeroapiKey(userId?: string): Promise<boolean> {
  if (!userId) return false;
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { aeroapiApiKey: true },
  });
  return !!decryptApiKey(row?.aeroapiApiKey ?? null);
}

// ---- budget ----------------------------------------------------------------

async function reserve(month: string, cost: number, budget: number): Promise<boolean> {
  if (cost > budget) return false;
  const rows = await prisma.$queryRaw<{ spent_milli_usd: number }[]>`
    INSERT INTO aeroapi_usage (month, spent_milli_usd, calls, updated_at)
    VALUES (${month}, ${cost}, 1, now())
    ON CONFLICT (month) DO UPDATE
      SET spent_milli_usd = aeroapi_usage.spent_milli_usd + ${cost},
          calls = aeroapi_usage.calls + 1,
          updated_at = now()
      WHERE aeroapi_usage.spent_milli_usd + ${cost} <= ${budget}
    RETURNING spent_milli_usd`;
  return rows.length > 0;
}

async function refund(month: string, cost: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE aeroapi_usage
      SET spent_milli_usd = GREATEST(spent_milli_usd - ${cost}, 0),
          calls = GREATEST(calls - 1, 0),
          updated_at = now()
      WHERE month = ${month}`;
}

/**
 * Permission to make ONE AeroAPI call: a rate slot and the call's cost
 * reserved against this month's budget. Not ok → make no request. When the
 * request then fails with an HTTP error answer (nothing was billed), call
 * `release()` to give the cost back.
 */
export async function requestAeroapiCall(
  kind: AeroapiCallKind,
  options: {
    maxWaitMs?: number;
    now?: Date;
    /**
     * The user whose OWN key makes this call. That bills the user's FlightAware
     * account, not the instance's: nothing is reserved or counted and the
     * instance budget never refuses it; only the per-key rate limit applies.
     */
    ownKeyOfUser?: string;
  } = {}
): Promise<AeroapiGate> {
  if (options.ownKeyOfUser) {
    const ok = await acquireRateSlot(options.maxWaitMs ?? 0, `user:${options.ownKeyOfUser}`);
    return ok
      ? { ok: true, cost: 0, release: async () => undefined }
      : { ok: false, reason: "rate_limit" };
  }
  const cost = AEROAPI_COST_MILLI_USD[kind];
  const month = utcMonthKey(options.now ?? new Date());
  const budget = budgetMilliUsd(await readBudgetSettings());

  if (!(await reserve(month, cost, budget))) {
    logger.warn(
      { api: "aeroapi", kind, month, budgetMilliUsd: budget, operation: "aeroapi_budget_reached" },
      "AeroAPI monthly budget reached; no request sent"
    );
    return { ok: false, reason: "budget" };
  }
  if (!(await acquireRateSlot(options.maxWaitMs ?? 0))) {
    await refund(month, cost);
    return { ok: false, reason: "rate_limit" };
  }
  return { ok: true, cost, release: () => refund(month, cost) };
}

export interface AeroapiUsageView {
  month: string;
  tier: AeroapiTier;
  customBudgetUsd: number | null;
  spentUsd: number;
  budgetUsd: number;
  calls: number;
  exhausted: boolean;
}

export async function getAeroapiUsage(now: Date = new Date()): Promise<AeroapiUsageView> {
  const month = utcMonthKey(now);
  const settings = await readBudgetSettings();
  const row = await prisma.aeroapiUsage.findUnique({ where: { month } });
  const spent = row?.spentMilliUsd ?? 0;
  const budget = budgetMilliUsd(settings);
  return {
    month,
    tier: settings.tier,
    customBudgetUsd: settings.customBudgetUsd,
    spentUsd: spent / 1000,
    budgetUsd: budget / 1000,
    calls: row?.calls ?? 0,
    exhausted: spent + AEROAPI_COST_MILLI_USD.flights > budget,
  };
}

/** Test helper. */
export function __resetAeroapiRateForTests(): void {
  recentCallsByBucket.clear();
}

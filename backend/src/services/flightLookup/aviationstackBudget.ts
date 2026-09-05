/**
 * Aviationstack API-sparing state: the 429 cooldown, the learned date-filter
 * restriction, the live window and the per-UTC-day call budget.
 *
 * Moved out of `flightLookup.ts` as one piece because it is one piece: every
 * value here is process-lifetime memory the provider cascade consults before
 * it spends a call, and the test reset has to clear all of it together or a
 * 429 learned in one test gates the next. The variables stay private — the
 * cascade reads and writes them through the functions below, which is what
 * lets them live in a file the cascade does not.
 */

import { prisma } from '../../db';

// In-memory cooldown for Aviationstack 429 (Free tier is 100 req/month —
// a single 429 means we've hit the wall; retrying minutely would be wasteful).
// Lives only in process memory, so it's rechecked after each restart.
const AVIATIONSTACK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let aviationstack429Until: Date | null = null;

export function isAviationstackCooledDown(): boolean {
  if (!aviationstack429Until) return false;
  if (Date.now() >= aviationstack429Until.getTime()) {
    aviationstack429Until = null;
    return false;
  }
  return true;
}

export function markAviationstack429(): void {
  aviationstack429Until = new Date(Date.now() + AVIATIONSTACK_COOLDOWN_MS);
}

/** When the current cooldown ends — for the log line beside `markAviationstack429`. */
export function aviationstackCooldownUntil(): Date | null {
  return aviationstack429Until;
}

// Aviationstack Free tier rejects the `flight_date` filter with 403
// `function_access_restricted` (real-time queries stay allowed). Learned at
// runtime from the first 403 and kept for the process lifetime so follow-up
// lookups stop burning budget calls on guaranteed failures.
let aviationstackDateFilterRestricted = false;

export function isAviationstackDateFilterRestricted(): boolean {
  return aviationstackDateFilterRestricted;
}

export function markAviationstackDateFilterRestricted(): void {
  aviationstackDateFilterRestricted = true;
}

// ─── API-sparing: tier gating + daily budget ────────────────────────────────
//
// Free tier constraints (as of 2026-04):
//   Aviationstack Free:  100 req/month (~3.3/day) — tightest by far
//   AirLabs Free:       ~1000 req/month
//   OpenSky:            ~400 queries/day
//
// Strategy: reserve Aviationstack for the "live window" (±3h around departure
// and during the flight) where its superior live-tracking data matters, and
// use AirLabs for bulk pre-departure schedule lookups. Combined with a daily
// Aviationstack budget this keeps us inside the Free tier indefinitely.

/** Treat `now ± 3 hours` and "still en route" as the live window. */
const LIVE_WINDOW_BEFORE_DEPARTURE_MS = 3 * 60 * 60 * 1000; // 3h
const LIVE_WINDOW_AFTER_ARRIVAL_MS = 2 * 60 * 60 * 1000;    // 2h

export function isInLiveWindow(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!departureTime) return false;
  const dep = typeof departureTime === 'string' ? new Date(departureTime) : departureTime;
  if (isNaN(dep.getTime())) return false;

  const nowMs = now.getTime();
  const depMs = dep.getTime();

  // Within ±3h of departure — covers pre-departure gate changes and first
  // hour of flight where live tracking is most useful.
  if (Math.abs(nowMs - depMs) <= LIVE_WINDOW_BEFORE_DEPARTURE_MS) return true;

  // In-flight and up to 2h past scheduled arrival — needed to capture actual
  // arrival time and final delay. Fall through to false if no arrival given.
  if (depMs < nowMs && arrivalTime) {
    const arr = typeof arrivalTime === 'string' ? new Date(arrivalTime) : arrivalTime;
    if (!isNaN(arr.getTime()) && nowMs <= arr.getTime() + LIVE_WINDOW_AFTER_ARRIVAL_MS) {
      return true;
    }
  }

  return false;
}

// Per-UTC-day Aviationstack call counter. In-memory only — resets on process
// restart. Small overshoot possible across restarts, but bounded by 429
// cooldown so it's never catastrophic.
let aviationstackDay: string | null = null;
let aviationstackTodayCount = 0;

export function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function resetBudgetIfNewDay(): void {
  const today = currentUtcDay();
  if (aviationstackDay !== today) {
    aviationstackDay = today;
    aviationstackTodayCount = 0;
  }
}

export function getAviationstackCallCountToday(): number {
  resetBudgetIfNewDay();
  return aviationstackTodayCount;
}

async function resolveAviationstackBudget(): Promise<number> {
  // Read admin setting; defaults to 3 per Prisma schema when the row exists.
  // If admin_settings is missing entirely (fresh DB before setup), fall back
  // to 3 so we don't accidentally hammer the API.
  try {
    const settings = await prisma.adminSettings.findFirst({
      select: { aviationstackDailyBudget: true },
    });
    return settings?.aviationstackDailyBudget ?? 3;
  } catch {
    return 3;
  }
}

export async function hasAviationstackBudget(): Promise<boolean> {
  resetBudgetIfNewDay();
  const budget = await resolveAviationstackBudget();
  if (budget <= 0) return false;
  return aviationstackTodayCount < budget;
}

export function recordAviationstackCall(): void {
  resetBudgetIfNewDay();
  aviationstackTodayCount++;
}

/** Test-only helper to reset the counter between unit tests. */
export function __resetAviationstackBudgetForTests(): void {
  aviationstackDay = null;
  aviationstackTodayCount = 0;
  aviationstack429Until = null;
  aviationstackDateFilterRestricted = false;
}

/** Test-only helper to simulate an already-learned date-filter restriction. */
export function __setAviationstackDateFilterRestrictedForTests(value: boolean): void {
  aviationstackDateFilterRestricted = value;
}

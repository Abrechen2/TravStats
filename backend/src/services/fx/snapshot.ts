/**
 * Currency snapshots, domain-neutral (#267).
 *
 * An amount is stored in the currency it was paid in. A snapshot records what
 * that amount was worth in the user's base currency ON THE DAY it happened,
 * together with the rate, the rate's date and where the rate came from. Keeping
 * the rate rather than only the converted number is what lets a figure be
 * explained years later, and what stops a historical total from drifting every
 * time the ECB publishes.
 *
 * This logic was written for lodging and lived inside `routes/lodging.ts`. It
 * moved here when flights needed it: flight costs were being summed across
 * currencies with no conversion at all, so 300 USD and 300 EUR were reported as
 * "600 €" — with the user's display symbol on it, which made a number that
 * cannot be computed honestly look authoritative. A route is not a place other
 * domains can import from, so the rule moved to where the FX service already
 * lives; `routes/lodging.ts` keeps a thin adapter that maps these generic
 * fields onto its own columns.
 *
 * Field names here are deliberately generic (`baseAmount`, not
 * `totalPriceBase`): a stay, a flight and a booking each store the snapshot in
 * their own columns, and a shared helper that spoke one domain's column names
 * would only invite the next caller to copy it instead of using it.
 *
 * Never throws. A failed lookup yields no snapshot rather than a failed
 * request — the user keeps their record either way.
 */

import { prisma } from "../../db";
import * as fx from "./resolver";
import type { RateSource } from "./resolver";

export interface FxSnapshot {
  /** The amount converted into the base currency. */
  baseAmount: number;
  /** Units of base currency per unit of the original currency. */
  rate: number;
  /** The day the rate is for — not the day it was looked up. */
  rateDate: Date;
  baseCurrency: string;
  /** Which provider answered. Kept as the resolver's own union so a caller
   * cannot store a source the rest of the system does not recognise. */
  source: RateSource;
}

/**
 * Why there is no snapshot. The distinction matters to the CALLER even though
 * every non-`snapshotted` outcome stores nulls: only `missingCurrency` says the
 * AMOUNT ITSELF is unusable, and only `amountRemoved` says the user meant to
 * clear it. Collapsing them at the boundary would throw that away.
 */
export type FxSnapshotOutcome =
  | { status: "amountRemoved" }
  | { status: "missingDate" }
  | { status: "missingCurrency" }
  | { status: "lookupFailed" }
  | { status: "snapshotted"; snapshot: FxSnapshot };

export interface FxSnapshotInput {
  amount: number | null | undefined;
  currency: string | null | undefined;
  /**
   * The day the money was spent. Must already be a real instant — an ISO-8601
   * UTC string or a Prisma `DateTime`. Never a bare "YYYY-MM-DD": building a
   * Date from one parses at LOCAL midnight, which shifts the rate day by ±1
   * for anyone east or west of UTC.
   */
  date: string | Date | null | undefined;
}

export async function snapshotFx(
  input: FxSnapshotInput,
  baseCurrency: string,
): Promise<FxSnapshotOutcome> {
  if (input.amount == null) return { status: "amountRemoved" };
  // A rate is a rate ON A DAY. An undated record has no day to look one up for,
  // and picking today's rate for a 2011 hotel produces a number that looks
  // converted and is not. The amount is kept in its own currency and reported
  // per-currency instead, exactly like a failed lookup.
  if (input.date == null) return { status: "missingDate" };
  // No `?? "EUR"`. An amount whose unit we never learned is not a euro amount;
  // guessing one is how 11,662 AED became €11,662 (see the 2026-08-13 spec).
  if (!input.currency) return { status: "missingCurrency" };

  const conv = await fx.convertToBase(input.amount, input.currency, baseCurrency, new Date(input.date));
  if (conv === null) return { status: "lookupFailed" };

  return {
    status: "snapshotted",
    snapshot: {
      baseAmount: conv.baseAmount,
      rate: conv.rate,
      rateDate: new Date(conv.rateDate),
      baseCurrency,
      source: conv.source,
    },
  };
}

/** The snapshot, or null when there is none. */
export function snapshotOrNull(outcome: FxSnapshotOutcome): FxSnapshot | null {
  return outcome.status === "snapshotted" ? outcome.snapshot : null;
}

/**
 * The currency every total is reported in for this user. Lived in
 * `routes/lodging.ts` until flights needed it too (#267) — a route is not a
 * place other domains import from.
 */
export async function getBaseCurrency(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  // The column is NOT NULL with a DB default of 'EUR' once a settings row
  // exists; the fallback only covers a user with no UserSettings row at all.
  return settings?.baseCurrency ?? "EUR";
}

/**
 * The five columns a flight or a booking stores, ready to spread into a Prisma
 * `data` object. All null when no honest conversion was possible — which the
 * statistics side reads as "report this one per currency instead of folding it
 * into the total", never as zero.
 */
export interface FxColumns {
  priceBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  fxSource: RateSource | null;
}

export const CLEARED_FX_COLUMNS: FxColumns = {
  priceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
};

export async function fxColumnsFor(
  input: FxSnapshotInput,
  baseCurrency: string,
): Promise<FxColumns> {
  const outcome = await snapshotFx(input, baseCurrency);
  if (outcome.status !== "snapshotted") return CLEARED_FX_COLUMNS;
  return {
    priceBase: outcome.snapshot.baseAmount,
    fxRate: outcome.snapshot.rate,
    fxRateDate: outcome.snapshot.rateDate,
    fxBaseCurrency: outcome.snapshot.baseCurrency,
    fxSource: outcome.snapshot.source,
  };
}

/**
 * A flight's own cost is `price + taxes + fees`, matching what the statistics
 * fall back to when the flight has no priced booking. Returns null when none of
 * the three is set — a flight with no price recorded is not a zero-cost flight.
 */
export function flightOwnAmount(f: {
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
}): number | null {
  if (f.price == null && f.taxes == null && f.fees == null) return null;
  return (f.price ?? 0) + (f.taxes ?? 0) + (f.fees ?? 0);
}

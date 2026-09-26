/**
 * The FX snapshot of an EDITED record — one home for flights, cruises and
 * the spreadsheet import (silent-failure fixes, 2026-09-26).
 *
 * Each of them decided "did an FX input change?" by whether the field was
 * SENT. The edit dialogs always send price, currency and date, so changing
 * only a seat re-snapshotted the flight, and a failed rate lookup (ECB and
 * fallbacks down) then wrote nulls over a good snapshot: `priceBase` and
 * `fxRate` were gone and the flight dropped out of every converted total. An
 * export re-imported unchanged did the same to every row whose date cell
 * carried a time the column rounds.
 *
 * The rule here: compare the NEXT inputs with the STORED ones and do nothing
 * when they agree. When they differ, snapshot afresh. When that lookup fails,
 * keep what can honestly be kept — the stored rate still converts the same
 * currency into the same base, so a new amount is re-priced with it and the
 * rate keeps naming its own day — and report that it was kept. Only a changed
 * currency (or base) leaves nothing to keep: the stored rate converts
 * something else, and a stale conversion is worse than none.
 */

import { minorUnits } from "../../shared/currencies";
import logger from "../../utils/logger";
import { CLEARED_FX_COLUMNS, snapshotFx, type FxColumns } from "./snapshot";

/** The three inputs a snapshot is computed from. */
export interface FxInputs {
  amount: number | null;
  currency: string | null;
  date: Date | null;
}

/** The stored row: its inputs and the snapshot computed from them. */
export interface StoredFx extends FxInputs {
  priceBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  fxSource: string | null;
}

/**
 * - `unchanged`: no input moved; nothing is written.
 * - `snapshotted`: a fresh rate for the new inputs.
 * - `cleared`: the inputs themselves leave nothing to convert (no amount, no
 *   currency, no date) — the honest state is no snapshot.
 * - `keptStoredRate`: the lookup failed; the stored rate re-priced the new
 *   amount (or stayed as it was).
 * - `lookupFailed`: the lookup failed and nothing stored applies (the
 *   currency changed, or there never was a rate): the snapshot is cleared.
 */
export type FxRefreshOutcome =
  "unchanged" | "snapshotted" | "cleared" | "keptStoredRate" | "lookupFailed";

export interface FxRefresh {
  columns: Partial<FxColumns>;
  outcome: FxRefreshOutcome;
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

export function fxInputsEqual(a: FxInputs, b: FxInputs): boolean {
  return a.amount === b.amount && a.currency === b.currency && sameInstant(a.date, b.date);
}

export async function refreshFxOnEdit(
  stored: StoredFx,
  next: FxInputs,
  baseCurrency: string,
  context: Record<string, unknown> = {}
): Promise<FxRefresh> {
  if (fxInputsEqual(stored, next)) return { columns: {}, outcome: "unchanged" };

  const snapshot = await snapshotFx(next, baseCurrency);
  if (snapshot.status === "snapshotted") {
    return {
      outcome: "snapshotted",
      columns: {
        priceBase: snapshot.snapshot.baseAmount,
        fxRate: snapshot.snapshot.rate,
        fxRateDate: snapshot.snapshot.rateDate,
        fxBaseCurrency: snapshot.snapshot.baseCurrency,
        fxSource: snapshot.snapshot.source,
      },
    };
  }
  if (snapshot.status !== "lookupFailed") {
    return { columns: CLEARED_FX_COLUMNS, outcome: "cleared" };
  }

  const rateStillApplies =
    stored.fxRate !== null &&
    stored.fxBaseCurrency === baseCurrency &&
    stored.currency === next.currency &&
    next.amount !== null;
  logger.warn({
    operation: "fx_refresh_lookup_failed",
    ...context,
    keptStoredRate: rateStillApplies,
  });
  if (!rateStillApplies) return { columns: CLEARED_FX_COLUMNS, outcome: "lookupFailed" };

  const factor = 10 ** minorUnits(baseCurrency);
  return {
    outcome: "keptStoredRate",
    columns: { priceBase: Math.round(next.amount! * stored.fxRate! * factor) / factor },
  };
}

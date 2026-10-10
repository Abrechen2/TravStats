import type { ExpenseKind } from "../shared/expenses";

/** Amount per ISO 4217 code — never summed across currencies. */
export type AmountsByCurrency = Record<string, number>;

/** One expense as the server answers it (forgejo#140). */
export interface TripExpense {
  id: string;
  /** Set for a trip-wide expense; then `routeId` is null. */
  tripId: string | null;
  /** Set for a roadtrip's or tour's; then `tripId` is null. */
  routeId: string | null;
  stopId: string | null;
  legFromStopId: string | null;
  legToStopId: string | null;
  kind: ExpenseKind;
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`, the local day it was paid; null when unknown. */
  date: string | null;
  note: string | null;
  /** Who paid (forgejo#150) — recorded, never split; null when not recorded. */
  payer: ExpensePayer | null;
  /** The recorded exchange rate; null — undated, or no rate could be had. */
  fx: ExpenseFx | null;
  /** Receipts filed with it: `GET /expenses/{id}/documents`. */
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Who paid. `companionId` is null for a plain name or a companion since
 * deleted; `name` is the companion's current name when linked.
 */
export interface ExpensePayer {
  companionId: string | null;
  name: string;
}

/**
 * Where a rate came from: `ecb` / `cdn` — the server looked it up; `cached` —
 * the phone's offline rate table; `manual` — typed. Mirrors
 * `EXPENSE_FX_SOURCES` in `backend/src/shared/expenses.ts`.
 */
export type ExpenseFxSource = "ecb" | "cdn" | "cached" | "manual";

export interface ExpenseFx {
  /** `amount` in `baseCurrency`, as the server rounded it. */
  amountBase: number;
  /** Units of `baseCurrency` per one unit of the expense's currency. */
  rate: number;
  /** `YYYY-MM-DD`, the day the rate is for. */
  rateDate: string;
  baseCurrency: string;
  source: ExpenseFxSource;
}

/**
 * The one figure that may cross currencies — and only through each expense's
 * own recorded rate. `unconverted` is what could NOT be added, per currency;
 * empty means `amount` is complete.
 */
export interface ExpenseBaseTotal {
  currency: string;
  amount: number;
  unconverted: AmountsByCurrency;
}

/**
 * What became of the exchange rate on a write. `lookupFailed` and
 * `keptStoredRate` are told to the user; the rest need no word.
 */
export type ExpenseFxOutcome =
  | "supplied"
  | "snapshotted"
  | "unchanged"
  | "undated"
  | "removed"
  | "keptStoredRate"
  | "lookupFailed";

/** POST and PATCH answer the stored expense and what became of its rate. */
export interface ExpenseWriteResult {
  expense: TripExpense;
  fxSnapshot: ExpenseFxOutcome;
}

/** What `GET /roadtrips/:id` adds: the money per station, per leg and in total. */
export interface RoadtripCosts {
  total: AmountsByCurrency;
  /** `total` in the reader's base currency, as far as recorded rates reach. */
  totalBase: ExpenseBaseTotal;
  byStation: Array<{ stopId: string; byCurrency: AmountsByCurrency }>;
  /** Keyed by the two STATIONS a leg runs between, as `legs` are. */
  byLeg: Array<{ fromStopId: string; toStopId: string; byCurrency: AmountsByCurrency }>;
  /** On the roadtrip but on no station or leg; counted in `total`. */
  unpinned: AmountsByCurrency;
}

/** POST body. A station OR a leg, never both. */
export interface ExpenseInput {
  kind: ExpenseKind;
  amount: number;
  currency: string;
  date?: string | null;
  note?: string | null;
  stopId?: string | null;
  legFromStopId?: string | null;
  legToStopId?: string | null;
  /** A companion's id, or a plain name; null clears, absent leaves it alone. */
  payer?: { companionId: string } | { name: string } | null;
  /**
   * A rate the client has. Absent: the server looks one up itself when
   * amount, currency or day changed. Null removes the stored rate.
   */
  fx?: ExpenseFxInput | null;
  /** POST only: kept documents to file with the new expense. */
  documentIds?: string[];
}

export interface ExpenseFxInput {
  rate: number;
  rateDate: string;
  baseCurrency: string;
  source: "cached" | "manual";
}

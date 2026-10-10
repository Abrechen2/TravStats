/**
 * Roadtrip and trip expenses (forgejo#140) — the vocabulary and the one rule
 * for adding money up. Mirrored at `frontend/src/shared/expenses.ts` — change
 * both together.
 */

/**
 * What an expense is for. `trip_expenses_kind` CHECKs the same list in the
 * database. The first six (and `other`) are the roadtrip's own (forgejo#140);
 * the rest widen it to a whole trip's spending (forgejo#150, owner D6):
 *
 * - `ferry`, `toll`, `pitch` (a campsite pitch fee), `fuel`, `parking`
 * - `charging` — charging an electric vehicle
 * - `transport` — getting about on the spot: taxi, local bus, metro, a day ticket
 * - `food` — eating out; `groceries` — food bought to cook
 * - `activity` — tickets, admission, guided tours
 * - `shopping` — souvenirs and other goods
 * - `fees` — visa, bank and service fees
 * - `other`
 */
export const EXPENSE_KINDS = [
  "ferry",
  "toll",
  "pitch",
  "fuel",
  "charging",
  "parking",
  "transport",
  "food",
  "groceries",
  "activity",
  "shopping",
  "fees",
  "other",
] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** Amounts are stored with four decimals: enough for every ISO 4217 minor unit. */
export const EXPENSE_AMOUNT_SCALE = 4;
const SCALE = 10 ** EXPENSE_AMOUNT_SCALE;

/**
 * Where an expense's exchange rate came from (forgejo#150): `ecb` / `cdn` — the
 * server looked it up; `cached` — a client's offline rate table, dated by its
 * as-of day; `manual` — typed by the user. `trip_expenses_fx_source` CHECKs it.
 */
export const EXPENSE_FX_SOURCES = ["ecb", "cdn", "cached", "manual"] as const;
export type ExpenseFxSource = (typeof EXPENSE_FX_SOURCES)[number];

/** The sources a client may supply; `ecb` and `cdn` are only ever the server's own lookup. */
export const CLIENT_FX_SOURCES = ["cached", "manual"] as const;

/**
 * Totals per currency, NEVER summed across currencies: "120 EUR + 900 NOK" is
 * the honest answer, and one number would invent a rate on a day nobody
 * recorded. `baseTotal` below is the one figure that may cross currencies, and
 * only through each expense's own recorded rate.
 *
 * Summed in integer ten-thousandths so 0.1 + 0.2 stays 0.3 — the stored
 * amounts are exact decimals, and a float drift would surface as 0.30000000004
 * in a total. A currency with no expense is absent, never 0.
 */
export function sumByCurrency(
  items: ReadonlyArray<{ amount: number; currency: string }>
): Record<string, number> {
  const units = new Map<string, number>();
  for (const { amount, currency } of items) {
    units.set(currency, (units.get(currency) ?? 0) + Math.round(amount * SCALE));
  }
  return Object.fromEntries([...units.entries()].map(([code, n]) => [code, n / SCALE]));
}

/** An expense as `baseTotal` reads it: its amount, and its recorded conversion if any. */
export interface BaseConvertible {
  amount: number;
  currency: string;
  /** `amount` in `fxBaseCurrency` at the recorded rate; null when no rate was recorded. */
  amountBase: number | null;
  fxBaseCurrency: string | null;
}

export interface BaseTotal {
  /** The user's current base currency. */
  currency: string;
  /** The sum of every expense that has an honest figure in `currency`. */
  amount: number;
  /**
   * Everything that has not, per its own currency: no rate recorded, or a rate
   * recorded into a base the user has since left. Empty means `amount` is the
   * whole of it; anything here means it is a part.
   */
  unconverted: Record<string, number>;
}

/**
 * The expenses in the user's base currency, through RECORDED rates only
 * (forgejo#150). An expense paid in the base currency counts as it is; one
 * with a rate recorded into that base counts its `amountBase`; every other
 * one is listed in `unconverted` in its own currency — never converted at a
 * rate nobody recorded, and never dropped.
 */
export function baseTotal(items: ReadonlyArray<BaseConvertible>, baseCurrency: string): BaseTotal {
  let units = 0;
  const rest: Array<{ amount: number; currency: string }> = [];
  for (const item of items) {
    if (item.currency === baseCurrency) units += Math.round(item.amount * SCALE);
    else if (item.amountBase !== null && item.fxBaseCurrency === baseCurrency) {
      units += Math.round(item.amountBase * SCALE);
    } else rest.push(item);
  }
  return { currency: baseCurrency, amount: units / SCALE, unconverted: sumByCurrency(rest) };
}

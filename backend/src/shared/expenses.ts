/**
 * Roadtrip and trip expenses (forgejo#140) — the vocabulary and the one rule
 * for adding money up. Mirrored at `frontend/src/shared/expenses.ts` — change
 * both together.
 */

/** What an expense is for. `trip_expenses_kind` CHECKs the same list in the database. */
export const EXPENSE_KINDS = ["ferry", "toll", "pitch", "fuel", "parking", "other"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** Amounts are stored with four decimals: enough for every ISO 4217 minor unit. */
export const EXPENSE_AMOUNT_SCALE = 4;
const SCALE = 10 ** EXPENSE_AMOUNT_SCALE;

/**
 * Totals per currency, NEVER summed across currencies: an expense carries no
 * FX snapshot, so "120 EUR + 900 NOK" is the honest answer and one number
 * would invent a rate on a day nobody recorded.
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

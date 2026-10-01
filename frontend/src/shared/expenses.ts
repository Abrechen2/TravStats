/**
 * Roadtrip and trip expenses (forgejo#140) — the vocabulary. Mirror of
 * `backend/src/shared/expenses.ts` — change both together. The sums come from
 * the server (`costs` on the roadtrip detail); the web never adds amounts up
 * itself, so there is one rule for a total and it lives there.
 */

/** What an expense is for. The database CHECKs the same list. */
export const EXPENSE_KINDS = ["ferry", "toll", "pitch", "fuel", "parking", "other"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/**
 * Expenses in the travel account (forgejo#140, owner 2026-10-01: "they count
 * in the year and total cost statistics"): every ferry, toll, pitch fee and
 * fuel stop, per year and in total — per currency, never summed across them.
 *
 * Pure — the caller loads the rows. An expense carries no FX snapshot, so
 * there is no base-currency figure here, the same reason `tripAccount.ts`
 * reports flights and cruises per currency.
 *
 * The year is the expense's own local DAY (a DATE column, ADR 0002 D1). An
 * undated one counts in the total and in no year, as an undated stay counts in
 * the totals and in no year: a guessed year would look exactly like a known one.
 */
import type { ExpenseAccount } from "../../schemas/statsDomains";
import { sumByCurrency } from "../../shared/expenses";
import { storedDay } from "../tripSuggestions/time";

export interface ExpenseAccountRow {
  amount: number;
  currency: string;
  date: Date | null;
}

export function buildExpenseAccount(rows: readonly ExpenseAccountRow[]): ExpenseAccount {
  const byYear = new Map<string, ExpenseAccountRow[]>();
  const undated: ExpenseAccountRow[] = [];
  for (const row of rows) {
    if (row.date === null) {
      undated.push(row);
      continue;
    }
    const year = storedDay(row.date).slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  return {
    count: rows.length,
    totalByCurrency: sumByCurrency(rows),
    years: [...byYear.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, items]) => ({
        year,
        count: items.length,
        byCurrency: sumByCurrency(items),
      })),
    undatedByCurrency: sumByCurrency(undated),
  };
}

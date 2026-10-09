import type { TripCost } from "../types/tripCost";
import { sumByCurrency, type CurrencyTotal } from "./bookingCost";

/**
 * The server's trip cost (`trip.cost`, forgejo#274), laid out for display:
 * EUR first, then alphabetical, a zero bucket dropped beside real money.
 *
 * Layout only. Each currency arrives once, already summed by the server's one
 * rule (`backend/src/shared/tripCost.ts`); nothing here decides what an entry
 * costs. `[]` when the server sent no cost — the caller shows a dash, never 0.
 */
export function tripCostTotals(cost: TripCost | null | undefined): CurrencyTotal[] {
  if (!cost) return [];
  return sumByCurrency(
    Object.entries(cost.spendByCurrency).map(([currency, price]) => ({ currency, price }))
  );
}

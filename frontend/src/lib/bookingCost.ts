export interface BookingCostInput {
  price: number | null;
  currency: string | null;
}

export interface CurrencyTotal {
  currency: string;
  total: number;
}

/** Per-currency booking totals. Currencies are NEVER summed together
 *  (no FX in 2.5); null currency means the schema default EUR; a null or
 *  zero price counts as "no price". EUR sorts first, the rest alphabetical. */
export function sumByCurrency(bookings: BookingCostInput[]): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const b of bookings) {
    if (b.price == null || b.price <= 0) continue;
    const currency = b.currency ?? "EUR";
    totals.set(currency, (totals.get(currency) ?? 0) + b.price);
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => {
      if (a.currency === "EUR") return -1;
      if (b.currency === "EUR") return 1;
      return a.currency.localeCompare(b.currency);
    });
}

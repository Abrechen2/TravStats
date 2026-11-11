import { create } from "zustand";
import { api } from "./api/client";
import { logger } from "./logger";
import { formatCurrency, type Currency } from "./units";

/**
 * Display currency (settings v3 `cur`): totals are summed in the base currency, the display
 * currency only changes how a total is written. The server owns the rate (`GET
 * /currencies/display-rate`, the same FX chain as every conversion); the client multiplies.
 *
 * Where no rate is known the amount stays in the base currency, labelled with it — a wrong
 * number is worse than an unconverted one.
 */
export interface DisplayRate {
  /** `base>display` — a rate is only valid for the pair it was fetched for. */
  pair: string;
  rate: number | null;
}

/** The amount and currency to show for a base-currency amount; pure, so the rule is tested alone. */
export function toDisplay(
  amount: number,
  base: Currency,
  display: Currency | null | undefined,
  known: DisplayRate | null
): { value: number; currency: Currency } {
  if (!display || display === base) return { value: amount, currency: base };
  if (known && known.pair === `${base}>${display}` && known.rate !== null && known.rate > 0) {
    return { value: amount * known.rate, currency: display };
  }
  return { value: amount, currency: base };
}

export function formatBaseAmount(
  amount: number,
  base: Currency,
  display: Currency | null | undefined,
  known: DisplayRate | null,
  opts?: { compact?: boolean; language?: string }
): string {
  const shown = toDisplay(amount, base, display, known);
  return formatCurrency(shown.value, shown.currency, opts);
}

interface DisplayRateStore {
  /** The rate per `base>display` pair (null: the server had none), so switching back needs no new call. */
  rates: Record<string, number | null>;
  /** Pairs asked for, so a missing rate is not re-requested on every render. */
  asked: string[];
  ensure: (base: Currency, display: Currency) => Promise<void>;
}

export const useDisplayRateStore = create<DisplayRateStore>((set, get) => ({
  rates: {},
  asked: [],
  ensure: async (base, display) => {
    const pair = `${base}>${display}`;
    if (get().asked.includes(pair)) return;
    set((s) => ({ asked: [...s.asked, pair] }));
    try {
      const res = await api.get<{ data: { base: string; display: string; rate: number | null } }>(
        "/currencies/display-rate"
      );
      const body = res.data.data;
      // The server answers for the account's current pair; store it under the pair it names.
      set((s) => ({ rates: { ...s.rates, [`${body.base}>${body.display}`]: body.rate } }));
    } catch (error) {
      // No rate is a state the amounts render (base currency); the next pair change asks again.
      logger.warn("display currency rate unavailable", error);
      set((s) => ({ asked: s.asked.filter((p) => p !== pair) }));
    }
  },
}));

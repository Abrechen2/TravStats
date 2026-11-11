import { useEffect, useMemo } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { useSuggestionSwitchesStore } from "../store/suggestionSwitchesStore";
import { formatBaseAmount, toDisplay, useDisplayRateStore } from "../lib/displayCurrency";

/**
 * Writes a sum or total that is held in the BASE currency, in the account's display currency
 * when one is set and a rate is known (otherwise in the base currency, labelled with it).
 * Single entries keep their own currency and never go through this.
 */
export type BaseMoney = ((
  amount: number,
  opts?: { compact?: boolean; language?: string }
) => string) & {
  /** The currency those amounts are written in right now: the display currency once its rate is known. */
  currency: string;
};

export function useBaseMoney(): BaseMoney {
  const base = useSettingsStore((s) => s.baseCurrency) || "EUR";
  const display = useSuggestionSwitchesStore((s) => s.displayCurrency);
  const known = useDisplayRateStore((s) => s.known);
  const ensure = useDisplayRateStore((s) => s.ensure);
  useEffect(() => {
    if (display && display !== base) void ensure(base, display);
  }, [base, display, ensure]);
  return useMemo(
    () =>
      Object.assign(
        (amount: number, opts?: { compact?: boolean; language?: string }) =>
          formatBaseAmount(amount, base, display, known, opts),
        { currency: toDisplay(0, base, display, known).currency }
      ),
    [base, display, known]
  );
}

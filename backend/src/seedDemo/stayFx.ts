/**
 * The currency snapshot a SEEDED lodging stay carries.
 *
 * Every seeded stay had a price and a currency and no snapshot, so the lodging
 * money tab of the demo account reported an empty base total and counted every
 * priced stay as "not converted" — `utils/lodgingStats/money.ts` sums only
 * `totalPriceBase` for stays snapshotted into the CURRENT base currency, and
 * has no "already in the base currency" shortcut the way the flight cost
 * aggregation does. So a demo account full of euro hotels showed nothing
 * (finding B4 of the independent review of 2026-09-17).
 *
 * The seed cannot call the FX providers: it runs on first boot, on a machine
 * that may have no network, and a rate for a 2017 hotel would be a live HTTP
 * request per stay. So it writes fixed rates. Two consequences follow, and
 * both are deliberate:
 *
 *  - `fxSource` is `"manual"`, never `"ecb"`. The stored vocabulary is
 *    `ecb | cdn | manual` and the stay card labels anything that is not
 *    `manual` or `cdn` as an ECB rate (`frontend/src/lib/lodgingFormat.ts`).
 *    A rate this file made up must not be presented as the European Central
 *    Bank's, and `manual` is precisely the word this system already has for
 *    "somebody supplied this, it is not official". A fourth value would have
 *    to be taught to that readout first, and until it was, a "seed" source
 *    would render as "EZB".
 *  - A currency with no plausible fixed rate gets NO snapshot. Abstention is a
 *    result: the stay keeps its own amount, the statistics report it per
 *    currency, and the "not converted" hint keeps a real example to show —
 *    which is what a user with an exotic currency actually sees.
 *
 * An amount that is ALREADY in the base currency is snapshotted at rate 1,
 * which is what the live write path stores too (`convertToBase` answers
 * `from === to` with rate 1), and the stay card suppresses the readout for a
 * same-currency pair, so no "120 € → 120 € · 1,0000" is shown.
 */

import { minorUnits } from "../shared/currencies";

/**
 * Rates into EUR, rounded to what a plausible mid-decade average was. They are
 * NOT accurate for any given day and are not meant to be: they exist so that
 * the demo account's money figures are computable and internally consistent.
 *
 * ZAR is missing ON PURPOSE — see the module comment. The Cape Town stay is
 * the demo account's example of an honestly unconverted stay.
 */
export const SEED_FX_RATES: Readonly<Record<string, number>> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  JPY: 0.0061,
  DKK: 0.134,
  SEK: 0.088,
  AED: 0.25,
  SGD: 0.68,
  THB: 0.026,
  AUD: 0.6,
};

export interface SeedFxColumns {
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: Date | null;
  fxBaseCurrency: string | null;
  fxSource: string | null;
}

const NO_SNAPSHOT: SeedFxColumns = {
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
};

export function seedFxColumns(
  stay: { totalPrice: number | null; currency: string; checkIn: Date },
  baseCurrency: string,
): SeedFxColumns {
  if (stay.totalPrice === null) return { ...NO_SNAPSHOT };
  const rate =
    stay.currency === baseCurrency ? 1 : (SEED_FX_RATES[stay.currency] ?? null);
  if (rate === null) return { ...NO_SNAPSHOT };
  // Round to the BASE currency's own precision, exactly as `convertToBase`
  // does — a fixed 2 stores a phantom fraction for a yen total.
  const factor = 10 ** minorUnits(baseCurrency);
  return {
    totalPriceBase: Math.round(stay.totalPrice * rate * factor) / factor,
    fxRate: rate,
    // The rate is for the day the money was spent, which is the check-in day.
    fxRateDate: stay.checkIn,
    fxBaseCurrency: baseCurrency,
    fxSource: "manual",
  };
}

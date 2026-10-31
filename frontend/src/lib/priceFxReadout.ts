import { formatStayPriceDisplay } from "./lodgingFormat";

/**
 * The FX snapshot stored beside a booked price (rail, bus, ferry, rental —
 * the same contract as a lodging stay's). Every field is optional because an
 * older API answer or a row written before the snapshot existed has none.
 */
export interface PriceFxSnapshot {
  price?: number | null;
  currency?: string | null;
  priceBase?: number | null;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxBaseCurrency?: string | null;
  fxSource?: string | null;
}

export interface PriceFxLabels {
  ecb: string;
  market: string;
  manual: string;
  none: string;
}

/**
 * One line saying how a price was converted ("120 USD → 110 € · EZB 0,9170 ·
 * 12.03.2026"), or null.
 *
 * Abstention is a result: no price, no currency, a price already in the base
 * currency, or a price nobody converted yields null — never a row of dashes.
 * The "no rate" marker is only shown where a conversion was due, so a total
 * that quietly leaves this entry out can be told from a complete one.
 */
export function priceFxReadout(
  entry: PriceFxSnapshot,
  language: string | undefined,
  labels: PriceFxLabels,
  baseCurrency?: string
): string | null {
  if (entry.price == null || !entry.currency) return null;
  const display = formatStayPriceDisplay(
    {
      totalPrice: entry.price,
      currency: entry.currency,
      totalPriceBase: entry.priceBase ?? null,
      fxRate: entry.fxRate ?? null,
      fxRateDate: entry.fxRateDate ?? null,
      fxBaseCurrency: entry.fxBaseCurrency ?? null,
      fxSource: entry.fxSource ?? null,
    },
    language,
    labels,
    baseCurrency
  );
  return display.fxReadout ?? display.marker;
}

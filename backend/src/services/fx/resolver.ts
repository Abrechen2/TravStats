import { getAdminFxSettings } from "../parserSettings";
import logger from "../../utils/logger";
import { getCdnRate } from "./currencyApiCdn";
import { getRate, type FxRate, type RateSource } from "./frankfurter";

// Re-exported so a consumer of the CHAIN never has to reach past it into one
// individual provider just to name the type of its answer.
export type { FxRate, RateSource };

/**
 * Ask the providers in order.
 *
 * The ECB is authoritative and self-hostable, so it goes first and its answer
 * is final — for the 30 currencies it publishes, nothing else is consulted and
 * the instance makes no request to jsDelivr at all. The CDN only ever sees the
 * queries the ECB cannot answer, and only while the admin leaves it on: a
 * self-hoster gets to decide whether their instance talks to a public CDN.
 *
 * Never throws. No rate is a valid, displayable state — the caller renders the
 * amount in its own currency and says plainly that it could not be converted.
 */
export async function resolveRate(from: string, to: string, date: string): Promise<FxRate | null> {
  try {
    const ecb = await getRate(from, to, date);
    if (ecb) return ecb;
  } catch (error) {
    // `getRate` documents itself as never throwing, but that promise lives in
    // another module — a broken provider must not take the chain down with it.
    logger.warn({ error, from, to, date }, "ECB FX lookup threw");
  }

  const settings = await getAdminFxSettings().catch((error) => {
    logger.warn({ error }, "FX settings unreadable — assuming the column default");
    return null;
  });
  // An unreadable settings row falls back to ON, matching the column's own
  // default: a database hiccup should not silently narrow what can be
  // converted, which would look to the user like currencies going missing.
  if (settings && !settings.cdnFallbackEnabled) return null;

  try {
    return await getCdnRate(from, to, date);
  } catch (error) {
    logger.warn({ error, from, to, date }, "CDN FX lookup threw");
    return null;
  }
}

export interface FxConversion {
  baseAmount: number;
  rate: number;
  rateDate: string;
  source: RateSource;
}

/**
 * Convert `amount` from `from` to `base` at whichever provider can answer for
 * `date`. null on failure.
 *
 * This used to live in `frankfurter.ts` and speak only to the ECB. It moved
 * here when the second provider arrived, so that BOTH the stay write path and
 * the editor's rate preview go through the same chain — a preview that said
 * "no rate" while the save quietly converted through the CDN would be worse
 * than no preview at all.
 */
export async function convertToBase(
  amount: number,
  from: string,
  base: string,
  date: Date
): Promise<FxConversion | null> {
  if (Number.isNaN(date.getTime())) {
    logger.warn({ from, base, date: String(date) }, "FX conversion rejected: invalid date");
    return null;
  }
  const rateDate = date.toISOString().slice(0, 10);
  const found = await resolveRate(from, base, rateDate);
  if (found === null) return null;
  return {
    baseAmount: Math.round(amount * found.rate * 100) / 100,
    rate: found.rate,
    rateDate,
    source: found.source,
  };
}

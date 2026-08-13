import logger from "../../utils/logger";
import type { FxRate } from "./frankfurter";

/**
 * Keyless daily rates from the @fawazahmed0/currency-api dataset on jsDelivr —
 * the SECOND provider, asked only for what the ECB does not carry.
 *
 * Measured 2026-08-13:
 *  - it answers for currencies the ECB never publishes (EGP -> EUR on
 *    2026-03-04 = 0.017284254, so 11,662 EGP is about EUR 201.57),
 *  - but its history starts in early April 2024: `@2024-04-01` answers,
 *    `@2024-03-01` is a 404. Anything older has no rate here EITHER, which is
 *    why "no rate" stays a real, displayable state rather than an error.
 *
 * The response is `{ date, "<from>": { "<to>": rate, … } }` with lower-case
 * keys, and carries crypto alongside fiat — we only ever read the one pair.
 */
const BASE_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api";

// Same reasoning as frankfurter.ts: a historical daily rate never changes, so
// a process-lifetime map keyed by the tuple is safe and small.
const rateCache = new Map<string, number>();

/** Units of `to` per 1 `from` on `date` (YYYY-MM-DD). null on any miss. */
export async function getCdnRate(from: string, to: string, date: string): Promise<FxRate | null> {
  if (from === to) return { rate: 1, source: "cdn" };
  const key = `${date}:${from}:${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return { rate: cached, source: "cdn" };

  const lowerFrom = from.toLowerCase();
  const lowerTo = to.toLowerCase();
  try {
    const res = await fetch(`${BASE_URL}@${date}/v1/currencies/${lowerFrom}.json`);
    if (!res.ok) {
      // A 404 is the ordinary answer for a date before the dataset begins or a
      // code it does not carry — an expected miss, not an incident. Logging it
      // at warn would fill error.log with normal operation (see #244/#245).
      const level = res.status === 404 ? "debug" : "warn";
      logger[level]({ from, to, date, status: res.status }, "CDN FX rate lookup non-OK");
      return null;
    }
    const body = (await res.json()) as Record<string, unknown>;
    const table = body[lowerFrom];
    const rate =
      typeof table === "object" && table !== null
        ? (table as Record<string, unknown>)[lowerTo]
        : undefined;
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      logger.warn({ from, to, date }, "CDN FX rate missing in response");
      return null;
    }
    rateCache.set(key, rate);
    return { rate, source: "cdn" };
  } catch (error) {
    logger.warn({ error, from, to, date }, "CDN FX rate lookup failed");
    return null;
  }
}

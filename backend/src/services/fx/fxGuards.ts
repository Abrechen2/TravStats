/**
 * The three things every FX provider has to get right, in one place.
 *
 * Both providers are thin clients around a public endpoint, and both had the
 * same three gaps (AUD-065, AUD-066, AUD-067). Keeping the rules here means a
 * third provider inherits them instead of repeating the bugs.
 */

/**
 * The time each provider gets, and what the whole chain gets.
 *
 * The chain is serial — ECB first, CDN only for what the ECB cannot answer —
 * and it runs INSIDE a write the browser is waiting on. The client gives that
 * write 10 s (`frontend/src/config/constants.ts`, `API_TIMEOUTS.DEFAULT`), so
 * the FX budget has to finish comfortably inside it and leave room for the
 * database work that follows.
 *
 * It did not: neither provider passed an abort signal to `fetch`, so a slow
 * provider ran as long as it liked. Measured with an 11-second provider — the
 * client gave up after 10.007 s with no stay in the database, and the stay
 * appeared anyway at 11.112 s, converted. The user saw a failed save that had
 * in fact succeeded (AUD-065).
 */
export const FX_PROVIDER_TIMEOUT_MS = 2500;
export const FX_CHAIN_BUDGET_MS = 6000;

/**
 * A rate has to be a positive, finite number.
 *
 * `Number.isFinite` alone accepts 0 and negatives, and both providers used it.
 * An ECB response carrying a numeric 0 was therefore accepted, cached for the
 * life of the process, and written: a stay of 100 USD stored
 * `totalPriceBase: 0, fxRate: 0` and answered HTTP 201. Zero is not a cheap
 * conversion, it is a missing one — and "no rate" is already a valid,
 * displayable state this code supports (AUD-067).
 */
export function isUsableRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Is `date` (YYYY-MM-DD) a day whose rate can no longer change?
 *
 * Historical daily rates are final, which is what makes an unbounded
 * process-lifetime cache safe. TODAY is not final: the ECB publishes around
 * midday, so the first answer of the morning can be superseded by the real one
 * hours later. Caching it for the life of the process froze it — measured, a
 * later conversion of 200 USD kept returning 180 EUR after the provider had
 * moved to 0.95, with no second request made (AUD-066).
 *
 * Compared in UTC because that is the calendar the rate dates are published on.
 * A future date is not settled either — it has no rate at all yet.
 */
export function isSettledRateDate(date: string, now: Date = new Date()): boolean {
  return date < now.toISOString().slice(0, 10);
}

/**
 * `fetch` with a deadline, so a provider that never answers cannot outlive the
 * request that asked.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FX_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

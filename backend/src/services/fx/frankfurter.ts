import logger from "../../utils/logger";

const BASE_URL = "https://api.frankfurter.app";
// Cache one rate per (from,to,date) for the process lifetime. Historical ECB
// rates never change, so an unbounded map keyed by the tuple is safe and small.
const rateCache = new Map<string, number>();

/**
 * Which provider a rate came from. Persisted per stay so a readout can be
 * honest: a bare number cannot tell an official ECB rate apart from one the
 * user typed in, and the UI must never present the second as the first.
 */
export type RateSource = "ecb" | "cdn" | "manual";

export interface FxRate {
  rate: number;
  source: RateSource;
}

/** Units of `to` per 1 `from` on `date` (YYYY-MM-DD). null on any failure. */
export async function getRate(from: string, to: string, date: string): Promise<FxRate | null> {
  if (from === to) return { rate: 1, source: "ecb" };
  const key = `${date}:${from}:${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return { rate: cached, source: "ecb" };
  try {
    const url = `${BASE_URL}/${date}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ from, to, date, status: res.status }, "FX rate lookup non-OK");
      return null;
    }
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.[to];
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      logger.warn({ from, to, date }, "FX rate missing in response");
      return null;
    }
    rateCache.set(key, rate);
    return { rate, source: "ecb" };
  } catch (error) {
    logger.warn({ error, from, to, date }, "FX rate lookup failed");
    return null;
  }
}

// `convertToBase` used to live here and it is deliberately gone: converting an
// amount is now a question for the whole provider chain, so it moved to
// `resolver.ts`. This module stayed what it always was — the ECB
// reference-rate client, one of the providers that chain asks.

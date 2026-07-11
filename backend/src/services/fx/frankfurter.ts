import logger from "../../utils/logger";

const BASE_URL = "https://api.frankfurter.app";
// Cache one rate per (from,to,date) for the process lifetime. Historical ECB
// rates never change, so an unbounded map keyed by the tuple is safe and small.
const rateCache = new Map<string, number>();

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Units of `to` per 1 `from` on `date` (YYYY-MM-DD). null on any failure. */
export async function getRate(from: string, to: string, date: string): Promise<number | null> {
  if (from === to) return 1;
  const key = `${date}:${from}:${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return cached;
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
    return rate;
  } catch (error) {
    logger.warn({ error, from, to, date }, "FX rate lookup failed");
    return null;
  }
}

export interface FxConversion {
  baseAmount: number;
  rate: number;
  rateDate: string;
}

/** Convert `amount` from `from` to `base` at the ECB rate for `date`. null on failure. */
export async function convertToBase(
  amount: number,
  from: string,
  base: string,
  date: Date,
): Promise<FxConversion | null> {
  if (Number.isNaN(date.getTime())) {
    logger.warn({ from, base, date: String(date) }, "FX conversion rejected: invalid date");
    return null;
  }
  const rateDate = toIsoDate(date);
  if (from === base) return { baseAmount: amount, rate: 1, rateDate };
  const rate = await getRate(from, base, rateDate);
  if (rate === null) return null;
  return { baseAmount: Math.round(amount * rate * 100) / 100, rate, rateDate };
}

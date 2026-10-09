/**
 * Transforms added for the issuer readers moved out in plan 2026-10-09 P4b:
 * rail class wording, a day-month resolved against a dated heading, an
 * arrival clock that may fall on the next day, the "<symbol> <amount>" price
 * line, the shared money reader, and an address line split into its parts.
 *
 * None of them names an issuer — each reads a convention many senders share.
 * Like every v2 transform they are total: unreadable input is null.
 */
import { isCurrencyCode } from "../../../../shared/currencies";
import { parseAmount } from "../../../lodging/documentTotal";
import { splitAddressLine, type AddressParts } from "./addressParts";
import { isoDate } from "./calendar";
import type { TransformValue } from "./documentTransforms";

function asText(input: TransformValue): string | null {
  if (input === null) return null;
  const text = typeof input === "number" ? String(input) : input;
  return text.trim() === "" ? null : text;
}

/**
 * "2. Klasse", "Klasse: 1", "1. Kl.", "2nd class", "1re classe" → "first" /
 * "second". "BahnCard 50 (1. Klasse)" is the discount card's class, not the
 * ticket's, and is ignored.
 */
export function travelClass(input: TransformValue): "first" | "second" | null {
  const raw = asText(input);
  if (raw === null) return null;
  const text = raw.replace(/BahnCard[^,\n()]{0,20}\([12]\.\s*Klasse\)/gi, "");
  const match =
    /\b([12])\.\s*(?:Klasse|Kl\.)/i.exec(text) ??
    /\bKlasse:?\s*([12])\b/i.exec(text) ??
    /\b([12])(?:st|nd)\s+class\b/i.exec(text) ??
    /\b([12])(?:re|e|nde)\s+classe\b/i.exec(text);
  if (!match) return null;
  return match[1] === "1" ? "first" : "second";
}

/**
 * "02.05. 2016-05-02" → "2016-05-02": a day and month printed without a year,
 * dated by the reference date after it (a section heading "… am 02.05.2016").
 * A month more than six before the reference's is in the NEXT year — a
 * January row in a December trip.
 */
export function dayMonthNear(input: TransformValue): string | null {
  const text = asText(input);
  const m = text === null ? null : /(\d{1,2})\.(\d{1,2})\.?\s+(\d{4})-(\d{2})-\d{2}/.exec(text);
  if (!m) return null;
  const [day, month, refYear, refMonth] = [m[1], m[2], m[3], m[4]].map(Number);
  return isoDate(month < refMonth - 6 ? refYear + 1 : refYear, month, day);
}

function clock(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * "2026-12-20T22:30 00:05" → "2026-12-21T00:05": an arrival printed as a
 * clock only, on the departure's day — or the next one when it reads earlier
 * than the departure.
 */
export function laterClock(input: TransformValue): string | null {
  const text = asText(input);
  const m =
    text === null
      ? null
      : /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\s+(\d{1,2}:\d{2})$/.exec(text.trim());
  const arrival = m ? clock(m[3]) : null;
  if (!m || arrival === null) return null;
  return `${arrival < m[2] ? nextDay(m[1]) : m[1]}T${arrival}`;
}

/**
 * Currency symbols a price line prints in front of the amount. Booking.com
 * writes the dollar family with a country prefix and no space ("US$628,70",
 * "S$ 1.324,90"), which is why those forms are listed rather than folded into
 * a bare "$". Three-letter codes are checked against ISO 4217 instead, so the
 * table never has to grow for a new currency.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  US$: "USD",
  A$: "AUD",
  C$: "CAD",
  CA$: "CAD",
  NZ$: "NZD",
  HK$: "HKD",
  S$: "SGD",
  R$: "BRL",
};

/**
 * "€ 1.234,50", "CHF 292,83", "NOK 3.380", "US$628,70" — a price line that is
 * nothing but a currency and an amount. The symbol alternative comes first so
 * "US$" is read as a symbol rather than as the code "US". A three-letter token
 * that is no ISO code ("TEL 1.234,50") makes the line no price at all.
 */
function leadingPrice(input: TransformValue): { amount: number; currency: string } | null {
  const text = asText(input);
  const m = text === null ? null : /^([A-Z]{1,2}\$|[€$£¥]|[A-Z]{3})\s*([\d.,]+)$/.exec(text.trim());
  if (!m) return null;
  const currency = CURRENCY_SYMBOLS[m[1]] ?? (isCurrencyCode(m[1]) ? m[1] : null);
  const amount = currency ? parseAmount(m[2]) : null;
  return currency && amount !== null ? { amount, currency } : null;
}

export const leadingCurrency = (input: TransformValue): string | null =>
  leadingPrice(input)?.currency ?? null;
export const leadingAmount = (input: TransformValue): number | null =>
  leadingPrice(input)?.amount ?? null;

/**
 * The shared money reader every document total uses ("1,234.50" and
 * "1.234,50" alike: the rightmost separator is the decimal point). Negative
 * or digit-less input is no amount.
 */
export function amount(input: TransformValue): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  const text = asText(input);
  if (text === null || !/\d/.test(text)) return null;
  const value = parseAmount(text);
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

const addressPart =
  (part: keyof AddressParts) =>
  (input: TransformValue): string | null =>
    splitAddressLine(asText(input))[part];

export const addressStreet = addressPart("address");
export const addressPostcode = addressPart("postcode");
export const addressCity = addressPart("city");
export const addressCountry = addressPart("country");

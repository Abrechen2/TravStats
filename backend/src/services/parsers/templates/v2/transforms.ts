/**
 * Value transforms a v2 template may name (plan 2026-10-09 P2).
 *
 * Every transform is pure and TOTAL: input it cannot read becomes `null`, it
 * never throws. A template is community-written data, so a throw here would
 * be a template able to break a parse; a `null` is a field the template did
 * not manage to read, which the `required` list then reports by name.
 *
 * Dates come out as `YYYY-MM-DD` and times as `HH:MM` — calendar strings,
 * never a `Date`, because the document's zone is not known here and a
 * host-local `Date` would silently pick one (ADR 0002).
 */

import {
  airportName,
  capsTitleCase,
  dateTime,
  dropFirstWord,
  englishDate,
  firstDigits,
  germanDate,
  numericDate,
  removeSpaces,
  slashDayFirstDate,
  stripTrailingSeparator,
  type TransformContext,
  type TransformValue,
} from "./documentTransforms";
import { fullYear, isoDate, LETTERS, monthNumber } from "./calendar";
import {
  addressCity,
  addressCountry,
  addressPostcode,
  addressStreet,
  amount,
  dayMonthNear,
  laterClock,
  leadingAmount,
  leadingCurrency,
  travelClass,
} from "./vocabularyTransforms";

export type { TransformContext, TransformValue };
export type Transform = (input: TransformValue, ctx?: TransformContext) => TransformValue;

function asText(input: TransformValue): string | null {
  if (input === null) return null;
  const text = typeof input === "number" ? String(input) : input;
  return text.trim() === "" ? null : text;
}

/** Wraps a string-to-string step so empty results become null too. */
function textStep(step: (text: string) => string): Transform {
  return (input) => {
    const text = asText(input);
    if (text === null) return null;
    const out = step(text);
    return out.trim() === "" ? null : out;
  };
}

// ------------------------------------------------------------------ money

/**
 * "3.249,00", "3,249.00", "3249", "1 899,00 €", "EUR 2,437.00" → number.
 * With both separators present, the LAST one is the decimal mark. With one
 * kind only, it is a thousands mark when it repeats or is followed by exactly
 * three digits ("1.234" is 1234), otherwise the decimal mark ("12,50").
 */
function money(input: TransformValue): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const text = asText(input);
  if (text === null) return null;
  const match = /-?\d[\d.,\s\u00a0\u202f']*/.exec(text);
  if (!match) return null;
  const raw = match[0].replace(/[\s\u00a0\u202f']/g, "").replace(/[.,]+$/, "");
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let normalised: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    normalised = raw.split(thousands).join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = raw.split(sep);
    const isThousands = parts.length > 2 || parts[parts.length - 1].length === 3;
    normalised = isThousands ? parts.join("") : parts.join(".");
  } else {
    normalised = raw;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

// ------------------------------------------------------------------ currency

const CURRENCY_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/€|\beuro?s?\b/i, "EUR"],
  [/£/, "GBP"],
  [/\$/, "USD"],
];

function currency(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(text)) return code;
  const code = /(?:^|[^A-Za-z])([A-Za-z]{3})(?![A-Za-z])/.exec(text);
  return code ? code[1].toUpperCase() : null;
}

// ------------------------------------------------------------------ date

const DATE_READERS: ReadonlyArray<(text: string) => string | null> = [
  (text) => {
    const m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
    return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  },
  (text) => {
    const m = /\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/.exec(text);
    return m ? isoDate(fullYear(m[3]), Number(m[2]), Number(m[1])) : null;
  },
  (text) => {
    const re = new RegExp(`\\b(\\d{1,2})\\.?\\s*([${LETTERS}]+)\\.?,?\\s+(\\d{4}|\\d{2})(?!\\d)`);
    const m = re.exec(text);
    const month = m ? monthNumber(m[2]) : undefined;
    return m && month ? isoDate(fullYear(m[3]), month, Number(m[1])) : null;
  },
  (text) => {
    const re = new RegExp(`([${LETTERS}]+)\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`);
    const m = re.exec(text);
    const month = m ? monthNumber(m[1]) : undefined;
    return m && month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
  },
];

function date(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  for (const read of DATE_READERS) {
    const out = read(text);
    if (out) return out;
  }
  return null;
}

/** A day a document prints without its year: "14.05.", "14. Mai", "May 14". */
const MONTH_DAY_READERS: ReadonlyArray<(text: string) => [number, number] | null> = [
  (text) => {
    const m = /^\s*(\d{1,2})[./](\d{1,2})\.?\s*$/.exec(text);
    return m ? [Number(m[2]), Number(m[1])] : null;
  },
  (text) => {
    const m = new RegExp(`^\\s*(\\d{1,2})\\.?\\s*([${LETTERS}]+)\\.?\\s*$`).exec(text);
    const month = m ? monthNumber(m[2]) : undefined;
    return m && month ? [month, Number(m[1])] : null;
  },
  (text) => {
    const m = new RegExp(`^\\s*([${LETTERS}]+)\\.?\\s+(\\d{1,2})\\.?\\s*$`).exec(text);
    const month = m ? monthNumber(m[1]) : undefined;
    return m && month ? [month, Number(m[2])] : null;
  },
];

/**
 * A full date as `YYYY-MM-DD`, or — when the text is a day and month and
 * nothing else — the ISO 8601 year-less form `--MM-DD`. The year is never
 * guessed here: the domain consumer resolves it from a dated anchor (a
 * cruise's start date) or abstains. A day no year has (31 April) is null;
 * 29 February passes and is checked again once a year is known.
 */
function dateOrMonthDay(input: TransformValue): string | null {
  const full = date(input);
  if (full) return full;
  const text = asText(input);
  if (text === null) return null;
  for (const read of MONTH_DAY_READERS) {
    const md = read(text);
    if (md && isoDate(2000, md[0], md[1])) {
      return `--${String(md[0]).padStart(2, "0")}-${String(md[1]).padStart(2, "0")}`;
    }
  }
  return null;
}

// ------------------------------------------------------------------ time

function time(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const m = /(?<!\d)([01]?\d|2[0-3])[:.h]?([0-5]\d)(?!\d)/.exec(text);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** "+1" → 1. A missing offset is no offset: null or "" → 0. */
function dayOffset(input: TransformValue): number | null {
  if (typeof input === "number") return Number.isInteger(input) ? input : null;
  if (input === null || input.trim() === "") return 0;
  // A minus right after a digit is a date or range separator ("2026-05"), not an offset.
  const m = /(\+|(?<![\p{L}\d])-)\s*(\d{1,2})(?!\d)/u.exec(input);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]);
}

// ------------------------------------------------------------------ codes

const FLIGHT_NUMBER = /^([A-Z]{2}|[A-Z]\d|\d[A-Z]|[A-Z]{3})(\d{1,4}[A-Z]?)$/;

/** "QR 070" → "QR070": uppercase, spaces gone, leading zeros kept. */
function flightNumber(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const compact = text.toUpperCase().replace(/[\s\u00a0-]+/g, "");
  return FLIGHT_NUMBER.test(compact) ? compact : null;
}

function iata(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const trimmed = text.trim();
  return /^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

function integer(input: TransformValue): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.trunc(input) : null;
  const text = asText(input);
  if (text === null) return null;
  const m = /-?\d+/.exec(text);
  return m ? Number.parseInt(m[0], 10) : null;
}

export const TRANSFORMS = {
  trim: textStep((t) => t.trim()),
  text: textStep((t) => t.replace(/\s+/g, " ").trim()),
  upper: textStep((t) => t.toUpperCase()),
  lower: textStep((t) => t.toLowerCase()),
  titleCase: textStep((t) =>
    t
      .trim()
      .toLowerCase()
      .replace(/(^|[\s\-'’(/])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
  ),
  digits: textStep((t) => t.replace(/\D+/g, "")),
  integer,
  money,
  currency,
  date,
  dateOrMonthDay,
  time,
  dayOffset,
  flightNumber,
  iata,
  // Format-specific readers (documentTransforms.ts, plan P4a).
  englishDate,
  germanDate,
  numericDate,
  slashDayFirstDate,
  dateTime,
  airportName,
  capsTitleCase,
  firstDigits,
  dropFirstWord,
  stripTrailingSeparator,
  removeSpaces,
  // Shared conventions the P4b readers needed (vocabularyTransforms.ts).
  amount,
  travelClass,
  dayMonthNear,
  laterClock,
  leadingCurrency,
  leadingAmount,
  addressStreet,
  addressPostcode,
  addressCity,
  addressCountry,
} satisfies Record<string, Transform>;

export type TransformName = keyof typeof TRANSFORMS;
export const TRANSFORM_NAMES = Object.keys(TRANSFORMS) as [TransformName, ...TransformName[]];

/** Applies the named transforms in order; a null stays null except where a step reads it (dayOffset). */
export function applyTransforms(
  value: TransformValue,
  names: TransformName | readonly TransformName[] | undefined,
  ctx: TransformContext = {}
): TransformValue {
  if (names === undefined) return value === "" ? null : value;
  const list: readonly TransformName[] = typeof names === "string" ? [names] : names;
  return list.reduce<TransformValue>((acc, name) => TRANSFORMS[name](acc, ctx), value);
}

import { isCurrencyCode } from "../../../shared/currencies";
import { parseAmount } from "../documentTotal";
import {
  CURRENCY_SYMBOLS,
  parseGermanDate,
  type ParsedLodgingBooking,
} from "../bookingComTemplate";
import { finishLodgingRead, type LodgingRead } from "./finishRead";
import type { FieldRule, LodgingFieldRules, LodgingTemplate, TransformName } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // A date the calendar rejects (31 November) comes back as another day.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * "November 25, 2022", "25 November 2022", "01, Oct. 2018", "Oct 01".
 *
 * A year-less form is legal and common — Hilton prints "Check In: Oct 01" and
 * puts the year only in the subject — so this returns the month and day and
 * lets the caller supply the year (`yearFrom`). Without that the stay lands
 * in whichever year the import happens to run in, which is the class of bug
 * `referenceDate` exists to prevent on the flight side (#285).
 */
export function parseEnglishDate(raw: string, fallbackYear?: number): string | null {
  const text = raw.replace(/\./g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const month = (token: string): number | undefined => MONTHS[token.slice(0, 3).toLowerCase()];

  // "November 25 2022" / "Nov 25" (month first)
  let m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const mo = month(m[1]);
    const year = m[3] ? Number(m[3]) : fallbackYear;
    return mo && year ? iso(year, mo, Number(m[2])) : null;
  }

  // "25 November 2022" / "01 Oct 2018" (day first)
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const mo = month(m[2]);
    const year = m[3] ? Number(m[3]) : fallbackYear;
    return mo && year ? iso(year, mo, Number(m[1])) : null;
  }

  return null;
}

/**
 * "01.10.2026" — day, month, four-digit year. ALL Accor dates this way, and
 * `germanDate` only knows month NAMES. The round trip refuses a day the
 * calendar does not have, for the reason `parseGermanDate` gives: "31.04"
 * otherwise comes back as the first of May, a stay that looks read.
 */
export function parseNumericDate(text: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return iso(year, month, day);
}

/**
 * "MUSTERSTADT" → "Musterstadt". Only an all-capitals value is touched: the
 * sender shouted it, and a city stored in capitals shows in capitals on every
 * list. A value that already has lower case is the sender's own spelling.
 */
function toTitleCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function applyTransform(
  value: string,
  transform: TransformName | undefined,
  fallbackYear?: number
): string | number | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  switch (transform) {
    case "englishDate":
      return parseEnglishDate(text, fallbackYear);
    // The German reader lives in `bookingComTemplate.ts` and is reused rather
    // than copied: two month tables that must agree is how the continents
    // helper's two copies drifted.
    case "germanDate":
      return parseGermanDate(text);
    case "numericDate":
      return parseNumericDate(text);
    case "slashDayFirstDate":
      // Same day-month-year order and the same calendar check, only the
      // separator differs: "14/02/2017" is read as "14.02.2017".
      return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)
        ? parseNumericDate(text.replace(/\//g, "."))
        : null;
    case "titleCase":
      return toTitleCase(text.replace(/[,;]$/, "").trim());
    case "money":
      return parseAmount(text);
    case "digits": {
      const digits = /\d+/.exec(text);
      return digits ? digits[0] : null;
    }
    case "integer": {
      const digits = /\d+/.exec(text);
      return digits ? Number(digits[0]) : null;
    }
    case "currency": {
      // The capture is sometimes the code alone ("AED") and sometimes the
      // whole money line ("156,60 EUR"), because a stacked read takes the
      // line rather than a group. Try the exact token first, then look inside
      // — an ISO code validated against the registry, or a symbol from the
      // shared table. Anything else is no currency, and a price without one
      // is dropped by the caller.
      const exact = text.toUpperCase();
      if (CURRENCY_SYMBOLS[text]) return CURRENCY_SYMBOLS[text];
      if (isCurrencyCode(exact)) return exact;
      const code = /\b([A-Z]{3})\b/.exec(text.toUpperCase());
      if (code && isCurrencyCode(code[1])) return code[1];
      for (const [symbol, iso] of Object.entries(CURRENCY_SYMBOLS)) {
        if (text.includes(symbol)) return iso;
      }
      return null;
    }
    case "text":
    default:
      return text.replace(/[,;]$/, "").trim();
  }
}

/**
 * The value that belongs to a label sitting on a line of its own.
 *
 * Walks rather than matches, because neither regex shape is safe: a loose one
 * (`Anreise\s*\n\s*…`) crosses blank lines into the NEXT label's value, and a
 * tight one cannot cross the blank line CHECK24 really puts between label and
 * value. Walking makes the stop explicit — the first line with content, unless
 * that line is another of this sender's labels, in which case the field is
 * absent and the reader says so.
 */
function readStacked(lines: string[], label: string, labels: string[]): string | null {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/:$/, "");
  const wanted = norm(label);
  const stops = new Set(labels.map(norm));
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i]) !== wanted) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const value = lines[j].trim();
      if (value.length === 0) continue;
      return stops.has(norm(value)) ? null : value;
    }
    return null;
  }
  return null;
}

function readField(
  haystack: string,
  rule: FieldRule,
  subjectYear: number | undefined,
  lines: string[],
  labels: string[]
): string | number | null {
  if (rule.stacked) {
    const raw = readStacked(lines, rule.stacked, labels);
    if (raw === null) return null;
    const value = rule.dropLeadingWord ? raw.replace(/^\S+\s+/, "") : raw;
    return applyTransform(
      value,
      rule.transform,
      rule.yearFrom === "subjectYear" ? subjectYear : undefined
    );
  }

  for (const pattern of rule.patterns ?? []) {
    const match = new RegExp(pattern, rule.flags ?? "i").exec(haystack);
    if (!match) continue;
    // Capture 1 by convention; a rule that needs more builds them into one
    // group, so a template never depends on group NUMBERING across patterns.
    const captured = match[1];
    if (captured === undefined) continue;
    const value = applyTransform(
      captured,
      rule.transform,
      rule.yearFrom === "subjectYear" ? subjectYear : undefined
    );
    if (value !== null && value !== "") return value;
  }
  return null;
}

/** The year named anywhere in the subject, for a body that dates without one. */
function yearFromSubject(subject: string): number | undefined {
  const m = /\b(20\d{2})\b/.exec(subject);
  return m ? Number(m[1]) : undefined;
}

export function templateMatches(template: LodgingTemplate, haystack: string): boolean {
  const text = haystack.toLowerCase();
  const has = (needle: string): boolean => text.includes(needle.toLowerCase());
  return template.match.markers.every(has) && template.match.anchors.some(has);
}

/**
 * Read a document with one declarative template, or decline it.
 *
 * Declining is a result: `required` names what the reader must find, and a
 * template that matched the sender but cannot produce a stay returns null so
 * the document falls through to the next reader — rather than proposing a
 * booking with a name and no dates, which a human accepts by habit.
 */
export function applyLodgingTemplate(
  template: LodgingTemplate,
  subject: string,
  body: string
): ParsedLodgingBooking | null {
  const haystack = `${subject}\n${body}`;
  if (!templateMatches(template, haystack)) return null;

  const subjectYear = yearFromSubject(subject);
  const lines = haystack.split("\n").map((l) => l.replace(/\r$/, ""));
  const labels = template.labels ?? [];
  const read: LodgingRead = {};
  for (const [field, rule] of Object.entries(template.fields) as Array<
    [keyof LodgingFieldRules, FieldRule]
  >) {
    const value = readField(haystack, rule, subjectYear, lines, labels);
    if (value !== null) read[field] = value;
  }

  for (const field of template.required) {
    if (read[field] === undefined) return null;
  }

  return finishLodgingRead(read, {
    parserTemplate: template.name,
    checkOutYearBorrowed: Boolean(template.fields.checkOut?.yearFrom),
    type: template.classify?.type ?? null,
    chainName: template.classify?.chainName ?? null,
  });
}

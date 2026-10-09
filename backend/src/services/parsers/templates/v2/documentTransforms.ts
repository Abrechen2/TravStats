/**
 * Format-specific v2 transforms (plan 2026-10-09 P4a).
 *
 * The generic `date` transform guesses the layout from the text. The readers
 * below do not guess: each accepts exactly one layout and answers null for
 * anything else, which is what a template that KNOWS its sender's layout
 * wants — "02/03/2026" read day-first by a sender that writes month-first is
 * a wrong stay that looks read. They are the transforms the compiled-in
 * lodging and airline readers used, moved here so those readers can become
 * template files without losing a behaviour (P4: only generic readers stay
 * compiled into the server).
 *
 * Like every v2 transform they are total: unreadable input is null, never a
 * throw. Dates are `YYYY-MM-DD`, date-times `YYYY-MM-DDTHH:MM` — calendar
 * strings, never a `Date` (ADR 0002).
 */
import { airportCodeFromName } from "../airportNames";
import { fullYear, isoDate, LETTERS, monthNumber } from "./calendar";

export type TransformValue = string | number | null;

/** What a transform may know beyond its input: the year a field named by `yearFrom` read. */
export interface TransformContext {
  readonly year?: number;
}

function asText(input: TransformValue): string | null {
  if (input === null) return null;
  const text = (typeof input === "number" ? String(input) : input).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/**
 * "November 25, 2022", "25 November 2022", "01, Oct. 2018" — and the
 * year-less "Oct 01", which only reads when the context supplies a year
 * (`yearFrom`). Without one it is null: a stay resolved against today's year
 * silently files a 2018 night in 2026 (#285).
 */
export function englishDate(input: TransformValue, ctx: TransformContext = {}): string | null {
  const raw = asText(input);
  if (raw === null) return null;
  const text = raw.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const month = (token: string): number | undefined => monthNumber(token.slice(0, 3));

  const monthFirst = /^([A-Za-z]{3,9}) (\d{1,2})(?: (\d{4}))?$/.exec(text);
  if (monthFirst) {
    const mo = month(monthFirst[1]);
    const year = monthFirst[3] ? Number(monthFirst[3]) : ctx.year;
    return mo && year ? isoDate(year, mo, Number(monthFirst[2])) : null;
  }
  const dayFirst = /^(\d{1,2}) ([A-Za-z]{3,9})(?: (\d{4}))?$/.exec(text);
  if (dayFirst) {
    const mo = month(dayFirst[2]);
    const year = dayFirst[3] ? Number(dayFirst[3]) : ctx.year;
    return mo && year ? isoDate(year, mo, Number(dayFirst[1])) : null;
  }
  return null;
}

/** "10. März 2026", "10 März 2026" — a month NAME, anywhere in the text. */
export function germanDate(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const m = new RegExp(`(\\d{1,2})\\.?\\s*([${LETTERS}]+)\\s+(\\d{4})`).exec(text);
  if (!m) return null;
  const month = monthNumber(m[2]);
  return month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
}

/** "01.10.2026" — exactly day.month.four-digit-year, nothing around it. */
export function numericDate(input: TransformValue): string | null {
  const text = asText(input);
  const m = text === null ? null : /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  return m ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/**
 * "14/02/2017" — DAY first. Only for a sender measured to write day/month:
 * the same shape is month/day in the US.
 */
export function slashDayFirstDate(input: TransformValue): string | null {
  const text = asText(input);
  const m = text === null ? null : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return m ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "07:55" → "07:55", "7:55" → "07:55"; null for anything not a clock. */
function clock(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function withClock(date: string | null, time: string | undefined): string | null {
  if (date === null) return null;
  if (time === undefined) return `${date}T00:00`;
  const c = clock(time);
  return c === null ? null : `${date}T${c}`;
}

const NAMED = `[${LETTERS}]{3,9}`;
const DATE_TIME_READERS: ReadonlyArray<(text: string) => string | null> = [
  // "2025-09-18T07:25" — already a date-time; kept as written.
  (text) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? text : null),
  // "18 Sep 2025T07:25", "18. Oktober 2023 12:45", "18 Sep 2025"
  (text) => {
    const m = new RegExp(
      `^(\\d{1,2})\\.?\\s+(${NAMED})\\.?\\s+(\\d{4})(?:(?:T|\\s+)(\\d{1,2}:\\d{2}))?$`,
      "i"
    ).exec(text);
    const month = m ? monthNumber(m[2]) : undefined;
    return m && month ? withClock(isoDate(Number(m[3]), month, Number(m[1])), m[4]) : null;
  },
  // "23.05.2025T12:25" / "23.05.2025"
  (text) => {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:T(\d{1,2}:\d{2}))?$/.exec(text);
    return m ? withClock(isoDate(Number(m[3]), Number(m[2]), Number(m[1])), m[4]) : null;
  },
  // "17-Feb-14T09:10", "12. Aug. 23T21:05" — a two-digit year is 20yy.
  (text) => {
    const m = new RegExp(
      `^(\\d{1,2})(?:\\.\\s*|-|\\s+)(${NAMED})\\.?(?:-|\\s+)(\\d{2})T(\\d{1,2}:\\d{2})$`
    ).exec(text);
    const month = m ? monthNumber(m[2]) : undefined;
    return m && month ? withClock(isoDate(fullYear(m[3]), month, Number(m[1])), m[4]) : null;
  },
];

/**
 * A local date-time as `YYYY-MM-DDTHH:MM`, from the forms airline mails
 * print — usually assembled by a field's `format` from a date and a time
 * printed apart ("{1}T{2}"). A month the table does not know is null, never
 * January: a guessed month is a wrong flight.
 */
export function dateTime(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  for (const read of DATE_TIME_READERS) {
    const out = read(text);
    if (out) return out;
  }
  return null;
}

/** An airport or city name to its IATA code ("München" → "MUC"); null where it is ambiguous or unknown. */
export function airportName(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const code = airportCodeFromName(text);
  return code === "" ? null : code;
}

/**
 * "MUSTERSTADT" → "Musterstadt", and only an all-capitals value: the sender
 * shouted it. A value that already has lower case is the sender's own spelling.
 */
export function capsTitleCase(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The first run of digits, kept as TEXT — a booking reference is an
 * identifier, not a quantity, so a leading zero survives.
 * "260308233983 (gebucht am Mo. 9. Mrz 2026)" → "260308233983".
 */
export function firstDigits(input: TransformValue): string | null {
  const text = asText(input);
  const m = text === null ? null : /\d+/.exec(text);
  return m ? m[0] : null;
}

/** "Di. 10. März 2026" → "10. März 2026": the weekday in front of a date. */
export function dropFirstWord(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const out = text.replace(/^\S+\s+/, "");
  return out === "" ? null : out;
}

/** "Musterstadt," → "Musterstadt": the separator a line-based capture drags along. */
export function stripTrailingSeparator(input: TransformValue): string | null {
  const text = asText(input);
  if (text === null) return null;
  const out = text.replace(/[,;]$/, "").trim();
  return out === "" ? null : out;
}

/** "LH 2316" → "LH2316": every whitespace character removed, nothing validated. */
export function removeSpaces(input: TransformValue): string | null {
  const text = asText(input);
  return text === null ? null : text.replace(/\s+/g, "");
}

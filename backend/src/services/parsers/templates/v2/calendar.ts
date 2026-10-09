/**
 * Calendar helpers shared by every v2 date transform: one month table, one
 * calendar check. Two month tables that must agree is how the continents
 * helper's two copies drifted (CLAUDE.md, "a counting rule has one home").
 */

/** English and German month names and their common abbreviations, lower case. */
export const MONTH_NAMES: Readonly<Record<string, number>> = (() => {
  const table: Array<[number, string[]]> = [
    // English, German, and the French and Dutch names a rental station's
    // own-language invoice prints (Sixt, plan 2026-10-09 P4b).
    [1, ["january", "januar", "jänner", "jan", "jän", "janvier", "januari"]],
    [2, ["february", "februar", "feb", "fevrier", "février", "februari"]],
    [3, ["march", "märz", "maerz", "mar", "mär", "mrz", "mars", "maart"]],
    [4, ["april", "apr", "avril"]],
    [5, ["may", "mai", "mei"]],
    [6, ["june", "juni", "jun", "juin"]],
    [7, ["july", "juli", "jul", "juillet"]],
    [8, ["august", "aug", "aout", "août", "augustus"]],
    [9, ["september", "sep", "sept", "septembre"]],
    [10, ["october", "oktober", "oct", "okt", "octobre"]],
    [11, ["november", "nov", "novembre"]],
    [12, ["december", "dezember", "dec", "dez", "decembre", "décembre"]],
  ];
  return Object.fromEntries(table.flatMap(([n, names]) => names.map((name) => [name, n])));
})();

/** The month a name stands for, or undefined. Case-insensitive. */
export function monthNumber(name: string): number | undefined {
  return MONTH_NAMES[name.toLowerCase()];
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY-MM-DD`, or null for a day the calendar does not have (31 April). */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/** A two-digit year is this century — documents in the corpus are recent. */
export function fullYear(raw: string): number {
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

export const LETTERS = "A-Za-zÄÖÜäöüß";

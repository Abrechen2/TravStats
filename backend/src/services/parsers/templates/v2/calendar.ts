/**
 * Calendar helpers shared by every v2 date transform: one month table, one
 * calendar check. Two month tables that must agree is how the continents
 * helper's two copies drifted (CLAUDE.md, "a counting rule has one home").
 */

/** English and German month names and their common abbreviations, lower case. */
export const MONTH_NAMES: Readonly<Record<string, number>> = (() => {
  const table: Array<[number, string[]]> = [
    [1, ["january", "januar", "jänner", "jan", "jän"]],
    [2, ["february", "februar", "feb"]],
    [3, ["march", "märz", "maerz", "mar", "mär", "mrz"]],
    [4, ["april", "apr"]],
    [5, ["may", "mai"]],
    [6, ["june", "juni", "jun"]],
    [7, ["july", "juli", "jul"]],
    [8, ["august", "aug"]],
    [9, ["september", "sep", "sept"]],
    [10, ["october", "oktober", "oct", "okt"]],
    [11, ["november", "nov"]],
    [12, ["december", "dezember", "dec", "dez"]],
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

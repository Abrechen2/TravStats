/**
 * The one-line "what is in here" a folded section of the flight form shows
 * (forgejo#88, point 9).
 *
 * Folding a group is only safe if the fold cannot hide a value. Each builder
 * below lists the fields that are SET, as `Label: value`, and returns an empty
 * string when none are — an empty section has nothing to disclose, and a line
 * reading "nothing filled in" is a sentence about the user rather than about
 * their flight.
 *
 * Every label comes in already translated: these are pure functions over
 * strings so they can be tested without a React tree or an i18n instance, and
 * so the copy stays in the components that own it.
 */

export interface SummaryEntry {
  label: string;
  /** Anything falsy — "", undefined, 0 — is treated as "not filled in". */
  value: string | number | undefined | null;
}

const SEPARATOR = " · ";

/**
 * `Preis: 120 EUR · Sitz: 14A`.
 *
 * A zero is deliberately NOT shown: the form has no field where 0 is a
 * meaningful answer, and a price of 0 is what an untouched number input
 * reports in some browsers.
 */
export function summaryLine(entries: readonly SummaryEntry[]): string {
  return entries
    .filter((entry) => entry.value !== null && entry.value !== undefined && entry.value !== "")
    .filter((entry) => !(typeof entry.value === "number" && entry.value === 0))
    .map((entry) => `${entry.label}: ${String(entry.value)}`)
    .join(SEPARATOR);
}

/** `120 EUR` — or "" when there is no price, so `summaryLine` drops the entry. */
export function priceSummaryValue(price: number | undefined, currency: string): string {
  if (price === undefined || price === null || Number.isNaN(price) || price === 0) return "";
  return currency ? `${price} ${currency}` : String(price);
}

/** `3` for three tags — the COUNT, because a tag list is not a line of text. */
export function countValue(items: readonly string[]): number {
  return items.length;
}

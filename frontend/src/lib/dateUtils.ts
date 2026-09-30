/**
 * The date as a table shows it: `YYYY-MM-DD`.
 *
 * Round-4 decision E7 — ISO in tables, `DD.MM.YYYY` in prose. The four
 * logbooks printed four forms side by side ("Do 14.01.27", "2023-06-01",
 * "14.01.2027", "14.1.2027"; CT106 audit B11), and a localised date neither
 * sorts by eye nor stays put when the language changes.
 *
 * Zone-free since phase 4 of the time model (ADR 0002): a day that belongs
 * to a place comes as a `YYYY-MM-DD` string (`LocalDateValue.date`, or
 * `dayOf(TimeValue)`) and passes through unchanged; an instant that belongs
 * to no place (an account's creation) is read on the UTC clock — the only
 * clock such a value has — never in the reader's zone. The zone-taking
 * helpers this file used to hold moved to shared/time and
 * `lib/entityTimes.ts`, which read the place's clock from the server.
 */
const FALLBACK = "—";

export function formatIsoDate(input: Date | string): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? FALLBACK : date.toISOString().slice(0, 10);
}

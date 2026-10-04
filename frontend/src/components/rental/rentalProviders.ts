/**
 * Common rental and car-sharing companies, offered as SUGGESTIONS for the
 * provider field (forgejo#196). The field stays free text: a local company,
 * a broker's own brand or a spelling the reader prefers is kept exactly as
 * typed, and an existing row's `provider` string is never rewritten to match
 * an entry here — this list only saves typing.
 *
 * Alphabetical order is deliberately NOT used: the list leads with the
 * companies a reader in the DACH region is most likely to have rented from,
 * which is the order a suggestion list is scanned in.
 */
export const RENTAL_PROVIDER_SUGGESTIONS: readonly string[] = [
  "Sixt",
  "Avis",
  "Europcar",
  "Hertz",
  "Enterprise",
  "Budget",
  "Alamo",
  "National",
  "Thrifty",
  "Dollar",
  "Miles",
  "Share Now",
  "Free2Move",
  "Buchbinder",
  "Starcar",
];

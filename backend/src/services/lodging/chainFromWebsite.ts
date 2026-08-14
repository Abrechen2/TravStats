/**
 * Which hotel chain a booking website belongs to.
 *
 * The Places API has no brand or chain field — but it returns the hotel's own
 * website, and that identifies the group where the NAME often does not:
 * "Garner Hotel Erlangen Süd by IHG" links to ihg.com, "Hampton by Hilton
 * Konstanz" to hilton.com, "Novotel Suites Berlin" to all.accor.com. Measured
 * across the owner's 279 real houses: 269 carry a website, and 49 resolve to a
 * chain in the seeded catalogue this way.
 *
 * A POSITIVE LIST, deliberately, never "domain equals chain": one of those 279
 * links to `booking.softtec.software`, which is a booking vendor, not a group.
 * Guessing there would invent a chain nobody stays at, and the catalogue is
 * INSTANCE-WIDE — a wrong entry is wrong for every user of the instance.
 *
 * Brands map to the parent group because that is how the catalogue is cut:
 * Hampton, Waldorf and Conrad are all Hilton.
 */

/** Domain → the exact `LodgingChain.name` the seed uses. Keep both in step. */
const CHAIN_BY_DOMAIN: Readonly<Record<string, string>> = {
  // Hilton
  "hilton.com": "Hilton",
  "hiltonhotels.com": "Hilton",
  "hilton.de": "Hilton",
  // IHG
  "ihg.com": "IHG",
  "ihgplc.com": "IHG",
  // Marriott
  "marriott.com": "Marriott",
  "marriott.de": "Marriott",
  "marriotthotels.com": "Marriott",
  "ritzcarlton.com": "Marriott",
  "starwoodhotels.com": "Marriott",
  // Accor
  "accor.com": "Accor",
  "accorhotels.com": "Accor",
  "novotel.com": "Accor",
  "ibis.com": "Accor",
  "mercure.com": "Accor",
  "sofitel.com": "Accor",
  // Meliá
  "melia.com": "Meliá",
  "meliahotelsinternational.com": "Meliá",
  // NH
  "nh-hotels.com": "NH Hotels",
  "nh-hoteles.es": "NH Hotels",
  "nh-collection.com": "NH Hotels",
  // Radisson
  "radissonhotels.com": "Radisson",
  "radissonblu.com": "Radisson",
  "parkinn.com": "Radisson",
  // Scandic
  "scandichotels.com": "Scandic",
  "scandichotels.de": "Scandic",
  "scandichotels.se": "Scandic",
  // Best Western
  "bestwestern.com": "Best Western",
  "bestwestern.de": "Best Western",
  // Wyndham
  "wyndhamhotels.com": "Wyndham",
  "wyndham.com": "Wyndham",
  "ramada.com": "Wyndham",
  "daysinn.com": "Wyndham",
};

/**
 * The chain a website belongs to, or null when it is not a known group.
 *
 * Sub-domains count (`de.hilton.com`, `all.accor.com`), because a group runs
 * one per market — but only under a domain that is ON the list. An unknown
 * host returns null rather than a guess: an independent hotel's own site is
 * the normal case, not a failure.
 */
export function chainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;

  let host: string;
  try {
    host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Not a URL at all — the caller passes third-party data, so this is an
    // ordinary case rather than an error.
    return null;
  }

  const exact = CHAIN_BY_DOMAIN[host];
  if (exact) return exact;

  const parent = Object.keys(CHAIN_BY_DOMAIN).find((domain) => host.endsWith(`.${domain}`));
  return parent ? CHAIN_BY_DOMAIN[parent] : null;
}

/** Every chain name this module can produce — used by tests to keep it in step with the seed. */
export function knownChainNames(): string[] {
  return [...new Set(Object.values(CHAIN_BY_DOMAIN))].sort();
}

/**
 * All-mode nights per country (forgejo#399): the travel account's nights —
 * hotel, cabin, night train, night bus, night flight, ONE award per night by
 * the account's own precedence — attributed to the country they were spent in.
 *
 * A night is the same unit in every mode, so these may be added; what cannot
 * always be derived is WHERE. The rules, each an abstention where the data
 * does not say:
 *
 * - hotel: the lodging's country (`isoCountryCode`), nothing guessed from a name;
 * - night train / night bus: the country only when departure and arrival
 *   station are both known and the SAME. A border-crossing sleeper belongs to
 *   neither country alone, so it is `unattributed`;
 * - cabin (sea): `unattributed` — a night at sea or in a port is not a land
 *   country, and port-by-port attribution is not decided;
 * - air: `unattributed`.
 *
 * The account does not count a night nobody claims, so nights spent at home
 * with no record are not here either: this is a figure about recorded nights
 * away, useful as one input to a tax-residency question and never as the
 * answer to it.
 *
 * Abstention: no attributed night at all -> `null`.
 */
import type { AttributedNight, NightSource } from "../../../services/stats/travelAccount";

export interface NightsByCountryRow {
  country: string;
  hotel: number;
  rail: number;
  bus: number;
  total: number;
}

export interface NightsByCountry {
  totalNights: number;
  countries: NightsByCountryRow[];
  /** Nights whose country the records do not name, by the mode that awarded them. */
  unattributed: Record<NightSource, number>;
}

/** The country of the row that won a night, or null when it cannot be named. */
export type NightCountryOf = (source: NightSource, rowId: string) => string | null;

export function computeNightsByCountry(
  nights: readonly AttributedNight[],
  countryOf: NightCountryOf
): NightsByCountry | null {
  if (nights.length === 0) return null;
  const rows = new Map<string, NightsByCountryRow>();
  const unattributed: Record<NightSource, number> = { hotel: 0, sea: 0, rail: 0, bus: 0, air: 0 };
  for (const night of nights) {
    const source = night.awardedTo;
    const claimant = night.claims[source]?.[0];
    const country = claimant !== undefined ? countryOf(source, claimant) : null;
    if (country === null || (source !== "hotel" && source !== "rail" && source !== "bus")) {
      unattributed[source] += 1;
      continue;
    }
    const row = rows.get(country) ?? { country, hotel: 0, rail: 0, bus: 0, total: 0 };
    row[source] += 1;
    row.total += 1;
    rows.set(country, row);
  }
  return {
    totalNights: nights.length,
    countries: [...rows.values()].sort(
      (a, b) => b.total - a.total || a.country.localeCompare(b.country)
    ),
    unattributed,
  };
}

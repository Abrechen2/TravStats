/**
 * Which country a non-flight record proves — one answer per kind, one home.
 *
 * The passport row (`passport.ts`) and its drill-down (`countryDetail.ts`)
 * both have to decide whether a port call, a place visit or a house belongs to
 * a country, and forgejo#78 asked the row to COUNT them the way the detail
 * page already did. Two loops making that decision on their own is how a port
 * catalogued as "Deutschland" once counted toward a row and then vanished from
 * that row's drill-down. So the decision lives here, and both callers ask it.
 *
 * - A PORT CALL carries the catalogue's free-text country and resolves through
 *   `toCountryCode`, which tries both resolvers — the port catalogue writes
 *   "Deutschland" as readily as "Germany".
 * - A PLACE VISIT and a HOUSE carry a resolved `isoCountryCode` already; it is
 *   validated rather than trusted, because the column is nullable and holds
 *   whatever the geocoder wrote. A value that is not a country answers null
 *   and the record contributes nothing, as `shared/placeCounting.ts` does.
 *
 * `countEvidencePerCountry` is the fold the passport row needs: the same two
 * predicates, run once over every record, grouped by the code they resolve to.
 * The detail page counts the same records for ONE country by asking the same
 * predicates, so a row and its page cannot disagree about the number.
 */

import { toCountryCode } from "../../shared/countryEvidence";
import { isoCountryCode } from "../../utils/continents";

/** The country a sailed cruise's port call proves, or null when it cannot be known. */
export function portCallCountry(call: { country: string | null }): string | null {
  return toCountryCode(call.country);
}

/** The country a recorded place visit proves, or null when the place has none. */
export function placeVisitCountry(visit: { isoCountryCode: string | null }): string | null {
  return isoCountryCode(visit.isoCountryCode);
}

/** The country a house proves — the same validation a place gets. */
export function lodgingCountry(lodging: { isoCountryCode: string | null }): string | null {
  return isoCountryCode(lodging.isoCountryCode);
}

export interface EvidenceCounts {
  /** Port calls of sailed cruises in this country. */
  portCalls: number;
  /** Recorded visits to places in this country. */
  places: number;
}

/**
 * Port calls and place visits per country code. A record whose country cannot
 * be resolved is left out rather than filed somewhere plausible.
 */
export function countEvidencePerCountry(
  portCalls: readonly { country: string | null }[],
  placeVisits: readonly { isoCountryCode: string | null }[]
): Map<string, EvidenceCounts> {
  const out = new Map<string, EvidenceCounts>();
  const bump = (code: string | null, key: keyof EvidenceCounts): void => {
    if (!code) return;
    const acc = out.get(code) ?? { portCalls: 0, places: 0 };
    out.set(code, { ...acc, [key]: acc[key] + 1 });
  };
  for (const call of portCalls) bump(portCallCountry(call), "portCalls");
  for (const visit of placeVisits) bump(placeVisitCountry(visit), "places");
  return out;
}

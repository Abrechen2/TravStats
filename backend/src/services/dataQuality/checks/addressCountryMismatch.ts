import type { DataQualityEntityType } from "../../../schemas/dataQualityFlag";
import { resolveEvidenceCountry } from "../countryText";
import type { DataQualityFinding } from "../types";

/**
 * The geocoded country against the country written in the address.
 *
 * The live case this exists for (design §1.4): `Hotel Sport` was imported
 * carrying a Google Place ID for **Bucharest**, while its address reads Grajska
 * cesta 2, Otočec, **Slovenia**. Since a lodging with no stay now counts as a
 * night, that one bad row adds Romania to a passport — from a mistake in a third
 * party's database.
 *
 * What this check does NOT do is decide who is right. Both values are recorded
 * and neither is marked correct: a geocoder does not get a veto over the user's
 * own data. The record stays exactly as written and keeps counting exactly as
 * the rule says, until the user answers.
 *
 * ## Only the last component of the address is read
 *
 * By postal convention the country is the last comma-separated component, and
 * reading only that is what keeps the check quiet. Scanning every component
 * would resolve a street called Jordan, a district called Chad, a town called
 * Niger — country names are ordinary words in a lot of places.
 *
 * ## The known false positive, and why it is tolerable
 *
 * A first-level subdivision that shares its name with a country still trips
 * this: "…, Atlanta, Georgia" reads as GE against a claimed US. Suppressing it
 * would need a hand-maintained table of subdivision names in every language,
 * which is a list that is wrong the day it is written. A flag is a question, so
 * the cost of this one is a single dismissal — and `dismissed` is never
 * re-opened, so the user is asked exactly once.
 */

/** Below this, a tail is a state abbreviation or a house number, not a country. */
const MIN_COUNTRY_TAIL_LENGTH = 3;

export interface AddressBearingRecord {
  /** `lodging` or `place` — both carry the same address/country/iso triple. */
  entityType: Extract<DataQualityEntityType, "lodging" | "place">;
  id: string;
  address: string | null;
  /** Free text, as the source wrote it. */
  country: string | null;
  /** Derived from `country`; what everything that counts joins on. */
  isoCountryCode: string | null;
}

/**
 * The country component of a postal address, or null when it has none.
 *
 * Requires at least one comma: a single-component address is a street line, and
 * treating it as a country tail would read "Chad Street" as Chad.
 */
export function addressCountryTail(address: string): string | null {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;

  const tail = parts[parts.length - 1];
  return tail.length >= MIN_COUNTRY_TAIL_LENGTH ? tail : null;
}

export function findAddressCountryMismatches(
  records: readonly AddressBearingRecord[]
): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];

  for (const record of records) {
    if (!record.address) continue;

    const tail = addressCountryTail(record.address);
    if (!tail) continue;

    const addressCountryCode = resolveEvidenceCountry(tail);
    if (!addressCountryCode) continue;

    // The stored code is authoritative where it exists; falling back to the
    // free text covers rows written before `isoCountryCode` was derived.
    const claimedCountryCode =
      resolveEvidenceCountry(record.isoCountryCode) ?? resolveEvidenceCountry(record.country);

    // Abstention is a result: a record that claims no country at all disagrees
    // with nothing. That is a gap, not a contradiction, and this check has
    // nothing to say about it.
    if (!claimedCountryCode) continue;
    if (claimedCountryCode === addressCountryCode) continue;

    findings.push({
      entityType: record.entityType,
      entityId: record.id,
      kind: "address_country_mismatch",
      details: {
        claimedCountryCode,
        claimedCountryText: record.country,
        addressCountryCode,
        addressCountryText: tail,
        address: record.address,
      },
    });
  }

  return findings;
}

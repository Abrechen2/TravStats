import type { DataQualityEntityType } from "../../../schemas/dataQualityFlag";
import { resolveEvidenceCountry } from "../countryText";
import type { DataQualityFinding } from "../types";

/**
 * The stored coordinates against the stored country — design §3.5, row three.
 *
 * The other address check reads what a human wrote; this one reads where the
 * point actually falls, using the offline boundaries in
 * `services/geo/countryFromCoordinates.ts`. The two catch different mistakes: a
 * mistyped coordinate has a perfectly good address, and a mis-parsed address has
 * perfectly good coordinates.
 *
 * ## What it can never catch, stated so nobody assumes otherwise
 *
 * A WRONG-MATCH import writes a self-consistent row — the other hotel's
 * address, city, country AND coordinates, all agreeing with each other. That is
 * how `Hotel Sport` got in: the owner's Slovenian stay carries a Bucharest
 * hotel's entire record, and every field corroborates every other. No check
 * comparing a row against itself can see it, this one included. It is written
 * down in the design after that section was wrong about the same row twice.
 *
 * ## Two abstentions, both load-bearing
 *
 * **The sea is not a disagreement.** `countryAt` answers null for a coordinate
 * outside every outline, and a hotel on a spit of land, a port, or an island
 * smaller than the 1:10m outlines routinely lands there. Flagging those would
 * fill the inbox with the dataset's own resolution limit dressed up as the
 * user's error. Only a coordinate that falls squarely inside a DIFFERENT
 * country is a contradiction.
 *
 * **A country the dataset cannot see is not a disagreement either.** The
 * vendored outlines deliberately omit the territories Natural Earth does not
 * attribute, and a claimed code that never appears in `codes` could only ever
 * be reported as wrong — every one of its records would flag, none of them
 * because the user did anything. So the claim is only tested against a dataset
 * that could have confirmed it.
 */

export interface LocatedRecord {
  entityType: Extract<DataQualityEntityType, "lodging" | "place">;
  id: string;
  lat: number | null;
  lon: number | null;
  /** Free text, as the source wrote it. Fallback for rows written before the code existed. */
  country: string | null;
  isoCountryCode: string | null;
}

/** The boundary question, injected so this stays a pure function over data. */
export interface CoordinateCountryLookup {
  countryAt(lat: number, lon: number): string | null;
  /** Every code the dataset can answer. A claim outside it is untestable, not wrong. */
  readonly codes: ReadonlySet<string>;
}

export function findCoordinatesOutsideCountry(
  records: readonly LocatedRecord[],
  lookup: CoordinateCountryLookup
): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];

  for (const record of records) {
    const { lat, lon } = record;
    if (lat === null || lon === null) continue;

    const claimedCountryCode =
      resolveEvidenceCountry(record.isoCountryCode) ?? resolveEvidenceCountry(record.country);
    // Abstention is a result: a row claiming no country contradicts nothing.
    if (!claimedCountryCode) continue;
    if (!lookup.codes.has(claimedCountryCode)) continue;

    const coordinateCountryCode = lookup.countryAt(lat, lon);
    if (!coordinateCountryCode) continue;
    if (coordinateCountryCode === claimedCountryCode) continue;

    findings.push({
      entityType: record.entityType,
      entityId: record.id,
      kind: "coordinates_outside_country",
      details: { claimedCountryCode, coordinateCountryCode, lat, lon },
    });
  }

  return findings;
}

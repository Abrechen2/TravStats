/**
 * Canonical airline spelling — the ONE grouping key for "which airline was
 * this?" (#268).
 *
 * The statistics page used to count carriers two ways on one screen: the KPI
 * tile grouped the raw `flight.airline` string in the browser, while the
 * loyalty ranking below it grouped the server's normalised name. "Lufthansa"
 * and "Deutsche Lufthansa" were therefore two airlines in the tile and one in
 * the list directly underneath.
 *
 * Only the alias table and the two pure functions live here. Code resolution
 * (`resolveAirlineCodes`) stays in `backend/src/utils/airlineNormalize.ts`
 * because it needs the airline catalogue, and shipping that catalogue to the
 * browser to count names would be a bad trade.
 *
 * MIRRORED in `frontend/src/shared/airlineNormalize.ts` (the convention of
 * `shared/ratingDerivation.ts`). Both copies are covered by tests asserting the
 * same groupings.
 */

/**
 * Lowercased variant → canonical display name. Only add entries known to
 * actually appear in the database (different import sources, user typos).
 * NOT used for IATA/ICAO resolution — that goes through ALIAS_TO_AIRLINE.
 */
export const AIRLINE_ALIASES: Record<string, string> = {
  'egyptair': 'EgyptAir',
  'egypt air': 'EgyptAir',
  'air canada': 'Air Canada',
  'vietnam airline': 'Vietnam Airlines',
  'vietnam airlines': 'Vietnam Airlines',
  'dba': 'dba',
  'sas scandinavian airlines': 'SAS Scandinavian Airlines',
  'lot polish airlines': 'LOT Polish Airlines',
};

/**
 * Normalize an airline name to its canonical display form. Returns the
 * input trimmed (unchanged casing) if no alias maps it.
 */
export function normalizeAirline(name: string): string {
  const key = name.trim().toLowerCase();
  return AIRLINE_ALIASES[key] ?? name.trim();
}

/**
 * Merge airline counts that differ only by spelling/casing. Groups are
 * collapsed into the canonical name.
 */
export function mergeAirlineCounts(
  counts: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [name, count] of Object.entries(counts)) {
    const canonical = normalizeAirline(name);
    merged[canonical] = (merged[canonical] || 0) + count;
  }
  return merged;
}

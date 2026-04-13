/**
 * Airline name normalization — canonical spelling and casing.
 *
 * Entries map a lowercased variant to the official name. Only add entries
 * that are known to appear in the database due to different import sources.
 */
const AIRLINE_ALIASES: Record<string, string> = {
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
 * Normalize an airline name to its canonical form.
 * Returns the input unchanged if no alias is found.
 */
export function normalizeAirline(name: string): string {
  const key = name.trim().toLowerCase();
  return AIRLINE_ALIASES[key] ?? name.trim();
}

/**
 * Merge airline counts that differ only by spelling/casing.
 * Groups are collapsed into the canonical name.
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

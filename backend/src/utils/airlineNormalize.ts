/**
 * Airline name normalization — canonical spelling and casing, plus
 * resolution to IATA/ICAO codes from a free-text airline name.
 *
 * Used by:
 *   - flight create/update routes (auto-fill `airlineIata` / `airlineIcao`
 *     when the user only typed a name)
 *   - stats aggregation (merge spelling variants into one bucket)
 *
 * Strict-exact philosophy (issue #106B): we never substring-match. A wrong
 * code is worse than a missing code — Codex example: "Air India" being
 * resolved to "Indian Airlines" via .includes() would silently corrupt
 * data. Unknown names return null and the row keeps its IATA/ICAO empty.
 */

import { AIRLINES, type Airline } from '../data/airlines';

/**
 * Lowercased variant → canonical display name. Only add entries known to
 * actually appear in the database (different import sources, user typos).
 * NOT used for IATA/ICAO resolution — that goes through ALIAS_TO_AIRLINE.
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
 * Extra alias → IATA mapping for names users actually type that don't
 * match the canonical name in `airlines.ts` exactly. Add only when a real
 * miss is observed; do NOT speculate. Each entry is one explicit synonym,
 * not a fuzzy rule.
 */
const NAME_TO_IATA: Record<string, string> = {
  // Iberia variants
  'iberia airlines': 'IB',
  'iberia lae': 'IB',           // legal name "Iberia Líneas Aéreas"
  // Lufthansa
  'lufthansa airlines': 'LH',
  'lufthansa german airlines': 'LH',
  // British Airways
  'british airways plc': 'BA',
  // SAS — already in AIRLINE_ALIASES for spelling, also need IATA
  'sas': 'SK',
  'sas scandinavian airlines': 'SK',
  'scandinavian airlines': 'SK',
  // Air France / KLM
  'air france klm': 'AF',
  // ITA Airways successor of Alitalia — users still type the old name
  'alitalia': 'AZ',
  'ita airways': 'AZ',
  // United / American long forms
  'united': 'UA',
  'american': 'AA',
  'delta': 'DL',
  // EgyptAir — also in AIRLINE_ALIASES for spelling
  'egyptair': 'MS',
  'egypt air': 'MS',
};

/**
 * Build a lookup map from lowercase canonical name → Airline. Built once
 * at module load, NOT per call.
 */
const NAME_LOOKUP: Map<string, Airline> = new Map(
  AIRLINES.map((a) => [a.name.toLowerCase(), a]),
);

/**
 * Build IATA → Airline and ICAO → Airline lookups for direct-code input
 * (e.g. user typed "IB" or "IBE" instead of "Iberia").
 */
const IATA_LOOKUP: Map<string, Airline> = new Map(
  AIRLINES.map((a) => [a.iata.toUpperCase(), a]),
);
const ICAO_LOOKUP: Map<string, Airline> = new Map(
  AIRLINES.filter((a) => a.icao).map((a) => [a.icao!.toUpperCase(), a]),
);

/**
 * Normalize an airline name to its canonical display form. Returns the
 * input trimmed (unchanged casing) if no alias maps it.
 */
export function normalizeAirline(name: string): string {
  const key = name.trim().toLowerCase();
  return AIRLINE_ALIASES[key] ?? name.trim();
}

/**
 * Resolve a free-text airline name to its IATA + ICAO codes via strict
 * exact lookup. Returns null when nothing matches — never guesses.
 *
 * Match order:
 *   1. Direct IATA (input is exactly 2 chars and matches IATA, e.g. "IB")
 *   2. Direct ICAO (input is exactly 3 chars and matches ICAO, e.g. "IBE")
 *   3. Canonical name (case-insensitive, e.g. "Iberia" or "iberia")
 *   4. NAME_TO_IATA alias (e.g. "iberia airlines" → IB)
 */
export function resolveAirlineCodes(
  name: string,
): { iata: string; icao?: string; name: string } | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  // 1. Direct IATA code
  if (upper.length === 2) {
    const hit = IATA_LOOKUP.get(upper);
    if (hit) return { iata: hit.iata, icao: hit.icao, name: hit.name };
  }

  // 2. Direct ICAO code
  if (upper.length === 3) {
    const hit = ICAO_LOOKUP.get(upper);
    if (hit) return { iata: hit.iata, icao: hit.icao, name: hit.name };
  }

  // 3. Canonical name (case-insensitive)
  const byName = NAME_LOOKUP.get(lower);
  if (byName) return { iata: byName.iata, icao: byName.icao, name: byName.name };

  // 4. Explicit alias
  const aliasIata = NAME_TO_IATA[lower];
  if (aliasIata) {
    const hit = IATA_LOOKUP.get(aliasIata);
    if (hit) return { iata: hit.iata, icao: hit.icao, name: hit.name };
  }

  return null;
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

import { AIRCRAFT_TYPES } from '../data/aircraftTypes';
import { getAircraftCatalogSync } from '../services/aircraftCatalogCache';

/**
 * Hand-curated aliases that appear in imported flight data.
 * Key = lowercased alias, Value = canonical name from the aircraft catalogue.
 */
const ALIASES: Record<string, string> = {
  // Short Airbus codes
  'a318': 'Airbus A318',
  'a319': 'Airbus A319',
  'a320': 'Airbus A320',
  'a320-200': 'Airbus A320',
  'a321': 'Airbus A321',
  'a330': 'Airbus A330-300',
  'a330-200': 'Airbus A330-200',
  'a330-300': 'Airbus A330-300',
  'a340': 'Airbus A340-300',
  'a340-300': 'Airbus A340-300',
  'a340-600': 'Airbus A340-600',
  'a350': 'Airbus A350-900',
  'a350-900': 'Airbus A350-900',
  'a350-1000': 'Airbus A350-1000',
  'a380': 'Airbus A380-800',
  'a380-800': 'Airbus A380-800',

  // Bare Airbus short forms, same measurement as the Boeing block below.
  // A321LR keeps its own name rather than collapsing onto A321neo: it is the
  // long-range variant, and the point of normalising is one spelling per
  // aircraft, not one aircraft per family.
  'a220-100': 'Airbus A220-100',
  'a220-300': 'Airbus A220-300',
  'a320neo': 'Airbus A320neo',
  'a321neo': 'Airbus A321neo',
  'a321lr': 'Airbus A321LR',
  'a330-900': 'Airbus A330-900neo',
  'a330-900neo': 'Airbus A330-900neo',
  // Sharklets are a wingtip option, not a variant — the aircraft is an A320.
  'airbus a320 (sharklets)': 'Airbus A320',
  'a320 (sharklets)': 'Airbus A320',

  // Short Boeing codes
  'b737': 'Boeing 737-800',
  'b738': 'Boeing 737-800',
  'b747': 'Boeing 747-400',
  'b747-400': 'Boeing 747-400',
  'b747-8': 'Boeing 747-8',
  'b757': 'Boeing 757-200',
  'b757-200': 'Boeing 757-200',
  'b757-300': 'Boeing 757-300',
  'b767': 'Boeing 767-300',
  'b767-300': 'Boeing 767-300',
  'b777': 'Boeing 777-300ER',
  'b777-200': 'Boeing 777-200',
  'b777-200lr': 'Boeing 777-200LR',
  'b777-300er': 'Boeing 777-300ER',
  'b787': 'Boeing 787-9',
  'b787-8': 'Boeing 787-8',
  'b787-9': 'Boeing 787-9',
  'b787-10': 'Boeing 787-10',

  // Short forms measured in a real 335-flight library, where the SAME aircraft
  // appeared in two spellings at once ("B737-800" beside "Boeing 737-800").
  // Each expansion keeps the variant suffix: mapping "B767-300ER" onto the
  // catalogue's plain "Boeing 767-300" would make the column consistent by
  // throwing away the extended-range distinction, which is worse than leaving
  // it alone. So the target is the manufacturer-prefixed name, using the
  // catalogue's own spelling where it carries that exact variant.
  'b737-800': 'Boeing 737-800',
  'b737-900': 'Boeing 737-900',
  'b737-900er': 'Boeing 737-900ER',
  'b737 max 8': 'Boeing 737 MAX 8',
  'b737max8': 'Boeing 737 MAX 8',
  // Ryanair's 197-seat high-density MAX 8. A real variant, not a typo.
  'b737 max 8-200': 'Boeing 737 MAX 8-200',
  'b767-300er': 'Boeing 767-300ER',
  'b767-400': 'Boeing 767-400',
  'b767-400er': 'Boeing 767-400ER',
  'b777-200er': 'Boeing 777-200ER',

  // Full-name variants without subtype
  'boeing 737': 'Boeing 737-800',
  'boeing 737-800': 'Boeing 737-800',
  'boeing 747': 'Boeing 747-400',
  'boeing 747-400': 'Boeing 747-400',
  'boeing 747-8': 'Boeing 747-8',
  'boeing 757': 'Boeing 757-200',
  'boeing 757-200': 'Boeing 757-200',
  'boeing 757-300': 'Boeing 757-300',
  'boeing 767': 'Boeing 767-300',
  'boeing 767-300': 'Boeing 767-300',
  'boeing 777': 'Boeing 777-300ER',
  'boeing 777-200': 'Boeing 777-200',
  'boeing 777-300er': 'Boeing 777-300ER',
  'boeing 787': 'Boeing 787-9',
  'boeing 787-8': 'Boeing 787-8',
  'boeing 787-9': 'Boeing 787-9',
  'boeing 787-10': 'Boeing 787-10',

  // Embraer
  'e170': 'Embraer E170',
  'e175': 'Embraer E175',
  'e190': 'Embraer E190',
  'e195': 'Embraer E195',
  // E2 is the re-engined generation — a different aircraft, not a spelling of E195.
  'e190-e2': 'Embraer E190-E2',
  'e195-e2': 'Embraer E195-E2',
  'erj-145': 'Embraer ERJ-145',

  // CRJ
  'crj-200': 'Bombardier CRJ-200',
  'crj-700': 'Bombardier CRJ-700',
  'crj-900': 'Bombardier CRJ-900',
  'crj900': 'Bombardier CRJ-900',

  // ATR
  'atr 42': 'ATR 42-600',
  'atr 72': 'ATR 72-600',
  'atr42': 'ATR 42-600',
  'atr72': 'ATR 72-600',

  // Dash 8
  'dash 8': 'De Havilland Dash 8-400',
  'dash 8-400': 'De Havilland Dash 8-400',
  'dh8d': 'De Havilland Dash 8-400',
};

const byAlias = new Map<string, string>();
for (const [alias, canonical] of Object.entries(ALIASES)) {
  byAlias.set(alias, canonical);
}

// Cold-start fallback (curated list), used until the DB cache is preloaded —
// so normalizeAircraft is correct even in a script or test that never called
// preloadAircraftCatalog(), and never silently stops normalizing while the
// boot-time preload is still pending. AIRCRAFT_TYPES is already
// `{ icao, name }[]`, matching the cache's shape, so no mapping is needed.
function currentCatalog(): { icao: string; name: string }[] {
  const cat = getAircraftCatalogSync();
  return cat.length === 0 ? AIRCRAFT_TYPES : cat;
}

/**
 * Normalize an aircraft type string to the canonical display name.
 *
 * Tries (in order):
 * 1. Exact alias match (case-insensitive)
 * 2. ICAO code match against the current catalogue (e.g. "A319" → "Airbus A319")
 * 3. If the input is already a canonical name → return as-is
 * 4. Otherwise return the input trimmed but unchanged
 */
export function normalizeAircraft(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();

  // 1. Alias match
  const aliased = byAlias.get(lower);
  if (aliased) return aliased;

  const catalog = currentCatalog();
  const upper = trimmed.toUpperCase();

  // 2. ICAO code match
  for (const t of catalog) {
    if (t.icao.toUpperCase() === upper) return t.name;
  }

  // 3. Already canonical? (exact match in the name list)
  for (const t of catalog) {
    if (t.name.toLowerCase() === lower) return t.name;
  }

  return trimmed;
}

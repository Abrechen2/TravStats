import { AIRCRAFT_TYPES } from '../data/aircraftTypes';

/**
 * Build lookup maps from the canonical aircraft types list.
 *
 * Maps ICAO code → canonical name (e.g. "A319" → "Airbus A319")
 * and known aliases → canonical name.
 */
const byIcao = new Map<string, string>();
const byAlias = new Map<string, string>();

for (const t of AIRCRAFT_TYPES) {
  byIcao.set(t.icao.toUpperCase(), t.name);
}

// Hand-curated aliases that appear in imported flight data.
// Key = lowercased alias, Value = canonical name from AIRCRAFT_TYPES.
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

for (const [alias, canonical] of Object.entries(ALIASES)) {
  byAlias.set(alias, canonical);
}

/**
 * Normalize an aircraft type string to the canonical display name.
 *
 * Tries (in order):
 * 1. Exact alias match (case-insensitive)
 * 2. ICAO code match (e.g. "A319" → "Airbus A319")
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

  // 2. ICAO code match
  const icaoMatch = byIcao.get(trimmed.toUpperCase());
  if (icaoMatch) return icaoMatch;

  // 3. Already canonical? (exact match in the name list)
  for (const t of AIRCRAFT_TYPES) {
    if (t.name.toLowerCase() === lower) return t.name;
  }

  return trimmed;
}

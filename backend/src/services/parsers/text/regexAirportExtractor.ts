/**
 * Airport code extraction logic for the regex parser.
 * Extracts IATA codes from text using city name mappings,
 * labelled patterns, and context-aware heuristics.
 */

import {
  CITY_TO_IATA,
  IATA_CONTEXT_PATTERNS,
  IATA_FALSE_POSITIVES,
  VALID_IATA_CODES,
} from './regexMappings';

/** Normalize city name for lookup in CITY_TO_IATA */
export function normalizeCityName(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s-]/gi, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Check if an IATA code is valid (common airports only).
 * Helps filter out false positives like "OGO", "CRA", etc.
 */
export function isValidIATACode(code: string): boolean {
  return VALID_IATA_CODES.has(code.toUpperCase());
}

/** Extract a single departure/arrival pair from text */
export function extractAirportCodes(source: string): { departure?: string; arrival?: string } {
  const sourceLower = source.toLowerCase();
  const sourceUpper = source.toUpperCase();

  // Highest priority: "Von: City (MUC)" / "In: City (LUX)" lines
  const depM = source.match(/(?:^|\n)\s*(?:Von|Ab|From|Departure|Abflug(?:\s*-?\s*Ort)?)\s*:?\s*[^(\n]*\(([A-Z]{3})\)/im);
  const arrM = source.match(/(?:^|\n)\s*(?:In|Nach|To|Arrival|Ankunft(?:\s*-?\s*Ort)?)\s*:?\s*[^(\n]*\(([A-Z]{3})\)/im);
  if (depM && isValidIATACode(depM[1])) {
    return { departure: depM[1], arrival: arrM && isValidIATACode(arrM[1]) ? arrM[1] : undefined };
  }

  // Try city name mapping
  const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/iu;
  const cityMatch = cityPattern.exec(sourceLower);

  if (cityMatch) {
    const depCity = normalizeCityName(cityMatch[1]);
    const arrCity = normalizeCityName(cityMatch[2]);

    const departure = CITY_TO_IATA[depCity];
    const arrival = CITY_TO_IATA[arrCity];

    if (departure && arrival) {
      return { departure, arrival };
    }
  }

  // Try context-aware IATA patterns
  const codes: string[] = [];

  for (const pattern of IATA_CONTEXT_PATTERNS) {
    const matches = sourceUpper.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && /^[A-Z]{3}$/.test(match[1])) {
        codes.push(match[1]);
      }
      if (match[2] && /^[A-Z]{3}$/.test(match[2])) {
        codes.push(match[2]);
      }
    }
  }

  // Filter out false positives (common German words and invalid codes)
  const filtered = [...new Set(codes)].filter((code) => !IATA_FALSE_POSITIVES.includes(code));

  if (filtered.length >= 2) {
    return { departure: filtered[0], arrival: filtered[1] };
  }
  if (filtered.length === 1) {
    return { departure: filtered[0] };
  }

  return {};
}

/** Extract all airport code pairs from text (multi-flight support) */
export function extractAllAirportPairs(source: string): Array<{ departure?: string; arrival?: string }> {
  const pairs: Array<{ departure?: string; arrival?: string }> = [];
  const sourceLower = source.toLowerCase();
  const sourceUpper = source.toUpperCase();

  // Pattern 0 (highest priority): labelled IATA codes
  // Variant A: "Von: City Name (MUC)" / "In: City Name (LUX)" — IATA in parens
  const depIataMatches: Array<{ code: string; index: number }> = [];
  const arrIataMatches: Array<{ code: string; index: number }> = [];
  const depLinePattern = /(?:^|\n)\s*(?:von|ab|from|departure|abflug(?:\s*-?\s*ort)?)\s*:?\s*[^(\n]*\(([A-Z]{3})\)/gim;
  const arrLinePattern = /(?:^|\n)\s*(?:in|nach|to|arrival|ankunft(?:\s*-?\s*ort)?)\s*:?\s*[^(\n]*\(([A-Z]{3})\)/gim;
  for (const m of source.matchAll(depLinePattern)) {
    if (isValidIATACode(m[1])) depIataMatches.push({ code: m[1], index: m.index! });
  }
  for (const m of source.matchAll(arrLinePattern)) {
    if (isValidIATACode(m[1])) arrIataMatches.push({ code: m[1], index: m.index! });
  }

  // Variant B: "IATA-Code des Abflughafens MUC" / "IATA-Code des Ankunftsflughafens HEL"
  // Used in new Lufthansa 2025 plain-text emails
  for (const m of source.matchAll(/IATA-Code\s+des\s+Abflughafens\s+([A-Z]{3})\b/g)) {
    if (isValidIATACode(m[1])) depIataMatches.push({ code: m[1], index: m.index! });
  }
  for (const m of source.matchAll(/IATA-Code\s+des\s+Ankunftsflughafens\s+([A-Z]{3})\b/g)) {
    if (isValidIATACode(m[1])) arrIataMatches.push({ code: m[1], index: m.index! });
  }

  if (depIataMatches.length > 0 || arrIataMatches.length > 0) {
    const count = Math.max(depIataMatches.length, arrIataMatches.length);
    for (let i = 0; i < count; i++) {
      pairs.push({ departure: depIataMatches[i]?.code, arrival: arrIataMatches[i]?.code });
    }
    return pairs; // high-confidence result — skip lower-priority patterns
  }

  // Pattern 1: City names (von X nach Y)
  const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/giu;
  let cityMatch;
  while ((cityMatch = cityPattern.exec(sourceLower)) !== null) {
    const depCity = normalizeCityName(cityMatch[1]);
    const arrCity = normalizeCityName(cityMatch[2]);
    const departure = CITY_TO_IATA[depCity];
    const arrival = CITY_TO_IATA[arrCity];
    if (departure && arrival) {
      pairs.push({ departure, arrival });
    }
  }

  // Pattern 2: IATA codes in context (MUC → LUX, MUC-LUX, etc.)
  const iataPattern = /([A-Z]{3})\s*(?:->|-|\u2192|\u2194|\u2013|\u2014|\u27f6)\s*([A-Z]{3})/g;
  let iataMatch;
  while ((iataMatch = iataPattern.exec(sourceUpper)) !== null) {
    const dep = iataMatch[1];
    const arr = iataMatch[2];
    if (isValidIATACode(dep) && isValidIATACode(arr)) {
      pairs.push({ departure: dep, arrival: arr });
    }
  }

  // Pattern 3: Sequential IATA codes on same line (MUC FRA LUX)
  // Use whitespace boundaries (not \b) to avoid false positives from German umlauts
  // creating word boundaries inside words like "ÜBER DEN" → "BER" "DEN"
  const sequentialPattern = /(?:^|[ \t])([A-Z]{3})[ \t]+([A-Z]{3})(?=[ \t\r\n]|$)/gm;
  const codes: string[] = [];
  let seqMatch;
  while ((seqMatch = sequentialPattern.exec(sourceUpper)) !== null) {
    if (isValidIATACode(seqMatch[1]) && isValidIATACode(seqMatch[2])) {
      codes.push(seqMatch[1], seqMatch[2]);
    }
  }

  // Group sequential codes into pairs
  for (let i = 0; i < codes.length - 1; i += 2) {
    pairs.push({ departure: codes[i], arrival: codes[i + 1] });
  }

  return pairs;
}

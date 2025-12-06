import { getParserConfig, parseEmail } from './parsers/factory';
import { parse } from 'node-html-parser';

export interface ParsedBooking {
  airline?: string;
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  price?: string;
  currency?: string;
  // NEW FIELDS: Enhanced email parsing
  aircraft?: string;              // e.g., "Airbus A321", "Boeing 777-300ER"
  seatClass?: string;             // e.g., "Economy Light", "Business", "First"
  bookingReference?: string;      // Improved PNR detection (6 alphanumeric)
  ticketNumber?: string;          // e.g., "2202236084346" (typically 13 digits)
  boardingGroup?: string;         // e.g., "1", "A", "Zone 3"
  taxes?: string;                 // Tax amount (separate from total price)
  fees?: string;                  // Fees amount (separate from total price)
  missing: string[];
}

export interface ParseResult {
  flights: ParsedBooking[];
  parserUsed: 'ollama' | 'openai' | 'claude' | 'regex';
  ollamaAvailable: boolean;
  fallbackUsed?: boolean;
}

// City name to IATA code mapping (common German/European cities)
const CITY_TO_IATA: Record<string, string> = {
  // München / Munich
  'münchen': 'MUC',
  'munchen': 'MUC',
  'muenchen': 'MUC',
  'munich': 'MUC',

  // Frankfurt
  'frankfurt': 'FRA',

  // Berlin
  'berlin': 'BER',
  'berlin-tegel': 'TXL',

  // Hamburg
  'hamburg': 'HAM',

  // Düsseldorf
  'düsseldorf': 'DUS',
  'dusseldorf': 'DUS',
  'duesseldorf': 'DUS',

  // Köln / Cologne
  'köln': 'CGN',
  'koln': 'CGN',
  'koeln': 'CGN',
  'cologne': 'CGN',

  // Other German cities
  'stuttgart': 'STR',
  'hannover': 'HAJ',
  'nürnberg': 'NUE',
  'nurnberg': 'NUE',
  'nuernberg': 'NUE',
  'nuremberg': 'NUE',
  'leipzig': 'LEJ',
  'dresden': 'DRS',
  'bremen': 'BRE',

  // Luxembourg
  'luxemburg': 'LUX',
  'luxembourg': 'LUX',

  // Paris
  'paris': 'CDG',

  // London
  'london': 'LHR',

  // Amsterdam
  'amsterdam': 'AMS',

  // Brussels
  'brüssel': 'BRU',
  'brussel': 'BRU',
  'bruessel': 'BRU',
  'brussels': 'BRU',

  // Vienna
  'wien': 'VIE',
  'vienna': 'VIE',

  // Zurich
  'zürich': 'ZRH',
  'zurich': 'ZRH',
  genf: 'GVA',
  geneva: 'GVA',
  rom: 'FCO',
  rome: 'FCO',
  mailand: 'MXP',
  milan: 'MXP',
  barcelona: 'BCN',
  madrid: 'MAD',
  lissabon: 'LIS',
  lisbon: 'LIS',
  kopenhagen: 'CPH',
  copenhagen: 'CPH',
  stockholm: 'ARN',
  oslo: 'OSL',
  prag: 'PRG',
  prague: 'PRG',
  warschau: 'WAW',
  warsaw: 'WAW',
  budapest: 'BUD',
  istanbul: 'IST',
  athen: 'ATH',
  athens: 'ATH',
};

const FLIGHT_REGEX = /\b([A-Z]{2,3}\s?\d{1,4})\b/;
const PNR_REGEX = /\b([A-Z0-9]{6})\b/;
const ISO_DATE_TIME = /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\b/g;
const EURO_PRICE = /(\d{1,5}[.,]\d{2})\s?(EUR|\u20ac)/i;

// Context-aware IATA code extraction
const IATA_CONTEXT_PATTERNS = [
  /(?:von|ab|from|dep(?:arture)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s+(?:nach|to|arr(?:ival)?)/g,
  /(?:nach|to|arr(?:ival)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s*(?:->|-\>|-|\u2192|\u2194|\u2013|\u2014|\u27f6)\s*([A-Z]{3})/g, // MUC-LUX, MUC -> LUX, MUC → LUX
];

function extractText(html?: string): string {
  if (!html) return '';
  try {
    const root = parse(html);
    return root.text || '';
  } catch {
    return '';
  }
}

function normalizeCityName(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents/diacritics
    .replace(/[^a-z\s-]/gi, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function extractAirportCodes(source: string): { departure?: string; arrival?: string } {
  const sourceLower = source.toLowerCase();
  const sourceUpper = source.toUpperCase();

  console.log('[DEBUG] ==== AIRPORT CODE EXTRACTION ====');
  console.log('[DEBUG] Source length:', source.length);
  console.log('[DEBUG] Source preview:', source.substring(0, 200));

  // Try city name mapping first (most reliable for German emails)
  // Pattern stops at "am" (date), "on", digits, or line break to avoid capturing date
  const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/iu;
  const cityMatch = cityPattern.exec(sourceLower);

  console.log('[DEBUG] City pattern match:', cityMatch ? cityMatch[0] : 'NO MATCH');

  if (cityMatch) {
    const depCity = normalizeCityName(cityMatch[1]);
    const arrCity = normalizeCityName(cityMatch[2]);
    console.log('[DEBUG] Normalized cities:', { depCity, arrCity });

    const departure = CITY_TO_IATA[depCity];
    const arrival = CITY_TO_IATA[arrCity];
    console.log('[DEBUG] City to IATA lookup:', { departure, arrival });

    if (departure && arrival) {
      console.log('[DEBUG] ✅ SUCCESS via city name mapping:', { departure, arrival });
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

  console.log('[DEBUG] IATA codes found:', codes);

  // Remove duplicates and filter out common false positives
  const falsePositives = ['UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'FUR', 'MIT', 'AUF', 'AUS'];
  const filtered = [...new Set(codes)].filter((code) => !falsePositives.includes(code));

  console.log('[DEBUG] Filtered codes:', filtered);

  if (filtered.length >= 2) {
    console.log('[DEBUG] ✅ SUCCESS via IATA pattern:', { departure: filtered[0], arrival: filtered[1] });
    return { departure: filtered[0], arrival: filtered[1] };
  }
  if (filtered.length === 1) {
    console.log('[DEBUG] ⚠️ Only one code found:', filtered[0]);
    return { departure: filtered[0] };
  }

  console.log('[DEBUG] ❌ NO CODES FOUND');
  return {};
}

// Rename original function to internal use
function parseBookingEmailRegex(subject: string | undefined, text: string | undefined, html?: string): ParsedBooking {
  const source = [subject || '', text || '', extractText(html)].join('\n');
  const sourceUpper = source.toUpperCase();
  const missing: string[] = [];

  // Flight number
  const flightMatch = sourceUpper.match(FLIGHT_REGEX);
  const flightNumber = flightMatch ? flightMatch[1].replace(/\s+/g, '') : undefined;

  // PNR
  const pnrMatch = sourceUpper.match(PNR_REGEX);
  const pnr = pnrMatch ? pnrMatch[1] : undefined;

  // Airports (using improved context-aware extraction)
  const { departure: departureCode, arrival: arrivalCode } = extractAirportCodes(source);

  // Times (take first 2)
  const timeMatches = Array.from(source.matchAll(ISO_DATE_TIME)).map((m) => m[1]);
  const departureTime = timeMatches[0];
  const arrivalTime = timeMatches[1];

  // Seat
  const seatMatch = sourceUpper.match(/\b([0-9]{1,2}[A-Z])\b/);
  const seat = seatMatch ? seatMatch[1] : undefined;

  // Terminal/Gate (very heuristic)
  const terminalMatch = source.match(/Terminal\s+([A-Za-z0-9]+)/i);
  const gateMatch = source.match(/Gate\s+([A-Za-z0-9]+)/i);

  // Price
  const priceMatch = source.match(EURO_PRICE);
  const price = priceMatch ? priceMatch[1] : undefined;
  const currency = priceMatch ? 'EUR' : undefined;

  const result: ParsedBooking = {
    airline: flightNumber ? flightNumber.slice(0, 2) : undefined,
    flightNumber,
    departureCode,
    arrivalCode,
    departureTime,
    arrivalTime,
    pnr,
    seat,
    terminal: terminalMatch ? terminalMatch[1] : undefined,
    gate: gateMatch ? gateMatch[1] : undefined,
    price,
    currency,
    missing,
  };

  if (!flightNumber) missing.push('flightNumber');
  if (!departureCode) missing.push('departureCode');
  if (!arrivalCode) missing.push('arrivalCode');
  if (!departureTime) missing.push('departureTime');
  if (!arrivalTime) missing.push('arrivalTime');

  return result;
}

/**
 * Parse booking email using configured text parser
 *
 * This is the main entry point for email parsing. It will:
 * 1. Load user settings for parser preferences (if provided)
 * 2. Use parser factory to get the best available parser
 * 3. Parse email with selected parser (supports auto-mode and fallbacks)
 * 4. Return results with metadata about which parser was used
 *
 * @param subject - Email subject
 * @param text - Email plain text
 * @param html - Email HTML (optional)
 * @param userSettings - Optional user settings for parser configuration
 */
export async function parseBookingEmail(
  subject: string | undefined,
  text: string | undefined,
  html?: string,
  userSettings?: {
    preferredTextParser?: string | null;
    textFallbackChain?: string | null;
    openaiApiKey?: string | null;
    claudeApiKey?: string | null;
  }
): Promise<ParseResult> {
  console.log('[Booking Parser] Starting email parsing with factory system');

  // Get parser config from settings
  const config = getParserConfig(userSettings);

  // Parse email using factory
  const result = await parseEmail(
    subject || '',
    text || '',
    html,
    config
  );

  console.log(`[Booking Parser] Parsing complete - ${result.flights.length} flight(s) found`, {
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
  });

  // Map to legacy format for backward compatibility
  return {
    flights: result.flights,
    parserUsed: result.provider as any, // Map provider to legacy format
    ollamaAvailable: result.provider === 'ollama' || !result.fallbackUsed,
    fallbackUsed: result.fallbackUsed,
  };
}

// Legacy function kept for backward compatibility (deprecated - remove old code below)
// All the old regex/LLM parsing code can be removed in a future cleanup

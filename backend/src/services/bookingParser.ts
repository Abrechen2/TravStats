import { getParserConfig, parseEmail } from './parsers/factory';
import { parse } from 'node-html-parser';
import logger from '../utils/logger';

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

  logger.debug({
    operation: 'airport_code_extraction',
    message: 'Starting airport code extraction',
    context: { sourceLength: source.length, sourcePreview: source.substring(0, 200) },
  });

  // Try city name mapping first (most reliable for German emails)
  // Pattern stops at "am" (date), "on", digits, or line break to avoid capturing date
  const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/iu;
  const cityMatch = cityPattern.exec(sourceLower);

  logger.debug({
    operation: 'airport_code_city_pattern',
    message: cityMatch ? 'City pattern matched' : 'City pattern did not match',
    context: { match: cityMatch ? cityMatch[0] : null },
  });

  if (cityMatch) {
    const depCity = normalizeCityName(cityMatch[1]);
    const arrCity = normalizeCityName(cityMatch[2]);
    logger.debug({
      operation: 'airport_code_city_normalized',
      message: 'Normalized city names',
      context: { depCity, arrCity },
    });

    const departure = CITY_TO_IATA[depCity];
    const arrival = CITY_TO_IATA[arrCity];
    logger.debug({
      operation: 'airport_code_city_lookup',
      message: 'City to IATA lookup',
      context: { departure, arrival },
    });

    if (departure && arrival) {
      logger.debug({
        operation: 'airport_code_success_city',
        message: 'Successfully extracted airport codes via city name mapping',
        context: { departure, arrival },
      });
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

  logger.debug({
    operation: 'airport_code_iata_found',
    message: 'IATA codes found via pattern matching',
    context: { codes },
  });

  // Remove duplicates and filter out common false positives
  const falsePositives = ['UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'FUR', 'MIT', 'AUF', 'AUS'];
  const filtered = [...new Set(codes)].filter((code) => !falsePositives.includes(code));

  logger.debug({
    operation: 'airport_code_filtered',
    message: 'Filtered IATA codes',
    context: { filtered },
  });

  if (filtered.length >= 2) {
    logger.debug({
      operation: 'airport_code_success_iata',
      message: 'Successfully extracted airport codes via IATA pattern',
      context: { departure: filtered[0], arrival: filtered[1] },
    });
    return { departure: filtered[0], arrival: filtered[1] };
  }
  if (filtered.length === 1) {
    logger.debug({
      operation: 'airport_code_partial',
      message: 'Only one airport code found',
      context: { code: filtered[0] },
    });
    return { departure: filtered[0] };
  }

  logger.debug({
    operation: 'airport_code_not_found',
    message: 'No airport codes found',
  });
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
  },
  adminSettings?: {
    globalOpenaiApiKey?: string | null;
    globalClaudeApiKey?: string | null;
  }
): Promise<ParseResult> {
  logger.debug({
    operation: 'booking_parser_start',
    message: 'Starting email parsing with factory system',
  });

  // Get parser config from settings (user settings take precedence over admin settings)
  const config = getParserConfig(userSettings, adminSettings);

  // Parse email using factory
  const result = await parseEmail(
    subject || '',
    text || '',
    html,
    config
  );

  logger.info({
    operation: 'booking_parser_complete',
    message: `Parsing complete - ${result.flights.length} flight(s) found`,
    context: {
      flightCount: result.flights.length,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
    },
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

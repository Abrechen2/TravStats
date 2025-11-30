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
  missing: string[];
}

// City name to IATA code mapping (common German/European cities)
const CITY_TO_IATA: Record<string, string> = {
  munchen: 'MUC',
  muenchen: 'MUC',
  munich: 'MUC',
  frankfurt: 'FRA',
  berlin: 'BER',
  hamburg: 'HAM',
  dusseldorf: 'DUS',
  duesseldorf: 'DUS',
  koln: 'CGN',
  koeln: 'CGN',
  cologne: 'CGN',
  stuttgart: 'STR',
  hannover: 'HAJ',
  nurnberg: 'NUE',
  nuernberg: 'NUE',
  nuremberg: 'NUE',
  leipzig: 'LEJ',
  dresden: 'DRS',
  bremen: 'BRE',
  luxemburg: 'LUX',
  luxembourg: 'LUX',
  paris: 'CDG',
  london: 'LHR',
  amsterdam: 'AMS',
  brussel: 'BRU',
  bruessel: 'BRU',
  brussels: 'BRU',
  wien: 'VIE',
  vienna: 'VIE',
  zurich: 'ZRH',
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

  // Try city name mapping first (most reliable for German emails)
  const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+)/iu;
  const cityMatch = cityPattern.exec(sourceLower);

  if (cityMatch) {
    const departure = CITY_TO_IATA[normalizeCityName(cityMatch[1])];
    const arrival = CITY_TO_IATA[normalizeCityName(cityMatch[2])];

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

  // Remove duplicates and filter out common false positives
  const falsePositives = ['UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'FUR', 'MIT', 'AUF', 'AUS'];
  const filtered = [...new Set(codes)].filter((code) => !falsePositives.includes(code));

  if (filtered.length >= 2) {
    return { departure: filtered[0], arrival: filtered[1] };
  }
  if (filtered.length === 1) {
    return { departure: filtered[0] };
  }

  return {};
}

export function parseBookingEmail(subject: string | undefined, text: string | undefined, html?: string): ParsedBooking {
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

import { parse } from 'node-html-parser';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, PATTERNS } from '../shared/utils';
import logger from '../../../utils/logger';

// City name to IATA code mapping (common German/European cities)
const CITY_TO_IATA: Record<string, string> = {
  münchen: 'MUC', munchen: 'MUC', muenchen: 'MUC', munich: 'MUC',
  frankfurt: 'FRA',
  berlin: 'BER', 'berlin-tegel': 'TXL',
  hamburg: 'HAM',
  düsseldorf: 'DUS', dusseldorf: 'DUS', duesseldorf: 'DUS',
  köln: 'CGN', koln: 'CGN', koeln: 'CGN', cologne: 'CGN',
  stuttgart: 'STR', hannover: 'HAJ',
  nürnberg: 'NUE', nurnberg: 'NUE', nuernberg: 'NUE', nuremberg: 'NUE',
  leipzig: 'LEJ', dresden: 'DRS', bremen: 'BRE',
  luxemburg: 'LUX', luxembourg: 'LUX',
  paris: 'CDG', london: 'LHR', amsterdam: 'AMS',
  brüssel: 'BRU', brussel: 'BRU', bruessel: 'BRU', brussels: 'BRU',
  wien: 'VIE', vienna: 'VIE',
  zürich: 'ZRH', zurich: 'ZRH', genf: 'GVA', geneva: 'GVA',
  rom: 'FCO', rome: 'FCO', mailand: 'MXP', milan: 'MXP',
  barcelona: 'BCN', madrid: 'MAD', lissabon: 'LIS', lisbon: 'LIS',
  kopenhagen: 'CPH', copenhagen: 'CPH', stockholm: 'ARN', oslo: 'OSL',
  prag: 'PRG', prague: 'PRG', warschau: 'WAW', warsaw: 'WAW',
  budapest: 'BUD', istanbul: 'IST', athen: 'ATH', athens: 'ATH',
};

// Context-aware IATA code extraction patterns
const IATA_CONTEXT_PATTERNS = [
  /(?:von|ab|from|dep(?:arture)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s+(?:nach|to|arr(?:ival)?)/g,
  /(?:nach|to|arr(?:ival)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s*(?:->|-\>|-|\u2192|\u2194|\u2013|\u2014|\u27f6)\s*([A-Z]{3})/g,
];

/**
 * Regex-based Text Parser
 *
 * Fast, free, local parser using pattern matching for email parsing.
 *
 * Pros:
 * - Completely free
 * - Very fast
 * - No API required
 * - Predictable behavior
 *
 * Cons:
 * - Lower accuracy than LLMs
 * - Struggles with non-standard formats
 * - Requires pattern updates for new airlines
 */
export class RegexTextParser implements ITextParser {
  readonly provider: TextProvider = 'regex';

  async checkAvailability(): Promise<ProviderAvailability> {
    // Regex parser is always available
    return {
      available: true,
      metadata: {
        provider: 'regex',
        description: 'Pattern-based email parsing',
        cost: 'free',
      },
    };
  }

  async parseEmail(subject: string, text: string, html?: string): Promise<ParsedBooking[]> {
    logger.info('[Regex Parser] Starting email parsing');

    const source = [subject || '', text || '', this.extractText(html)].join('\n');
    const parsedFlight = this.parseBookingEmailRegex(source);

    logger.info('[Regex Parser] Parsing complete', {
      departureCode: parsedFlight.departureCode,
      arrivalCode: parsedFlight.arrivalCode,
      flightNumber: parsedFlight.flightNumber,
      missing: parsedFlight.missing,
    });

    // Return as array for consistency with LLM parsers
    return [parsedFlight];
  }

  /**
   * Extract text from HTML
   */
  private extractText(html?: string): string {
    if (!html) return '';
    try {
      const root = parse(html);
      return root.text || '';
    } catch {
      return '';
    }
  }

  /**
   * Normalize city name for lookup
   */
  private normalizeCityName(city: string): string {
    return city
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s-]/gi, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Extract airport codes from text
   */
  private extractAirportCodes(source: string): { departure?: string; arrival?: string } {
    const sourceLower = source.toLowerCase();
    const sourceUpper = source.toUpperCase();

    // Try city name mapping first
    const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/iu;
    const cityMatch = cityPattern.exec(sourceLower);

    if (cityMatch) {
      const depCity = this.normalizeCityName(cityMatch[1]);
      const arrCity = this.normalizeCityName(cityMatch[2]);

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

    // Filter out false positives
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

  /**
   * Parse booking email using regex patterns
   */
  private parseBookingEmailRegex(source: string): ParsedBooking {
    const sourceUpper = source.toUpperCase();
    const data: Partial<ParsedBooking> = {};

    // Flight number
    const flightMatch = sourceUpper.match(PATTERNS.FLIGHT_NUMBER);
    if (flightMatch) {
      data.flightNumber = flightMatch[1].replace(/\s+/g, '');
      data.airline = data.flightNumber.slice(0, 2);
    }

    // PNR
    const pnrMatch = sourceUpper.match(PATTERNS.PNR);
    if (pnrMatch) {
      data.pnr = pnrMatch[1];
      data.bookingReference = pnrMatch[1];
    }

    // Airports
    const { departure, arrival } = this.extractAirportCodes(source);
    data.departureCode = departure;
    data.arrivalCode = arrival;

    // Times (ISO format)
    const timeMatches = Array.from(source.matchAll(/\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)\b/g));
    if (timeMatches.length >= 1) data.departureTime = timeMatches[0][1];
    if (timeMatches.length >= 2) data.arrivalTime = timeMatches[1][1];

    // Seat
    const seatMatch = sourceUpper.match(PATTERNS.SEAT);
    if (seatMatch) data.seat = seatMatch[1];

    // Terminal
    const terminalMatch = source.match(PATTERNS.TERMINAL);
    if (terminalMatch) data.terminal = terminalMatch[1];

    // Gate
    const gateMatch = source.match(PATTERNS.GATE);
    if (gateMatch) data.gate = gateMatch[1];

    // Price
    const priceMatch = source.match(PATTERNS.PRICE_EUR);
    if (priceMatch) {
      data.price = priceMatch[1];
      data.currency = 'EUR';
    }

    // Ticket number
    const ticketMatch = source.match(PATTERNS.TICKET_NUMBER);
    if (ticketMatch) data.ticketNumber = ticketMatch[1];

    return normalizeParsedBooking(data);
  }
}

// Singleton instance
let instance: RegexTextParser | null = null;

export function getRegexParser(): RegexTextParser {
  if (!instance) {
    instance = new RegexTextParser();
  }
  return instance;
}

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
  salzburg: 'SZG',
  graz: 'GRZ',
  innsbruck: 'INN',
  linz: 'LNZ',
  basel: 'BSL',
  bern: 'BRN',
  zürich: 'ZRH', zurich: 'ZRH', genf: 'GVA', geneva: 'GVA',
  rom: 'FCO', rome: 'FCO', mailand: 'MXP', milan: 'MXP',
  barcelona: 'BCN', madrid: 'MAD', lissabon: 'LIS', lisbon: 'LIS',
  kopenhagen: 'CPH', copenhagen: 'CPH', stockholm: 'ARN', oslo: 'OSL',
  prag: 'PRG', prague: 'PRG', warschau: 'WAW', warsaw: 'WAW',
  budapest: 'BUD', istanbul: 'IST', athen: 'ATH', athens: 'ATH',
};

// PNR false positives (German words that match 6-char alphanumeric pattern)
const PNR_FALSE_POSITIVES = new Set([
  'VIELEN', 'DANKEN', 'SEHREN', 'WICHTIG', 'BESTEN', 'GRUSS', 'GRUESSE',
  'HERZLI', 'FREUND', 'SCHONEN', 'GUTEN', 'GUTER', 'GUTES', 'NEUEN',
  'NEUER', 'NEUES', 'ALTE', 'ALTEN', 'ALTES', 'GROSS', 'GROSSE',
  'KLEIN', 'KLEINE', 'SCHON', 'SCHONE', 'SCHONER', 'SCHONES', 'NEUE',
]);

const MONTH_NAMES: Record<string, string> = {
  'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAI': '05', 'MAY': '05',
  'JUN': '06', 'JUL': '07', 'AUG': '08', 'SEP': '09', 'OKT': '10', 'OCT': '10',
  'NOV': '11', 'DEZ': '12', 'DEC': '12',
  'JANUAR': '01', 'JANUARY': '01', 'FEBRUAR': '02', 'FEBRUARY': '02',
  'MÄRZ': '03', 'MÄR': '03', 'MAERZ': '03', 'MARCH': '03',
  'APRIL': '04', 'JUNI': '06', 'JUNE': '06', 'JULI': '07', 'JULY': '07', 'AUGUST': '08',
  'SEPTEMBER': '09', 'OKTOBER': '10', 'OCTOBER': '10', 'NOVEMBER': '11',
  'DEZEMBER': '12', 'DECEMBER': '12',
};

/** Add N calendar days to an ISO datetime string (YYYY-MM-DDTHH:MM) */
function addDays(iso: string, days: number): string {
  const tIdx = iso.indexOf('T');
  const datePart = tIdx >= 0 ? iso.slice(0, tIdx) : iso;
  const timePart = tIdx >= 0 ? iso.slice(tIdx + 1) : '00:00';
  const [y, m, d] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}T${timePart}`;
}

// Context-aware IATA code extraction patterns
const IATA_CONTEXT_PATTERNS = [
  /(?:von|ab|from|dep(?:arture)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s+(?:nach|to|arr(?:ival)?)/g,
  /(?:nach|to|arr(?:ival)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s*(?:->|-|\u2192|\u2194|\u2013|\u2014|\u27f6)\s*([A-Z]{3})/g,
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

    try {
      const source = [subject || '', text || '', this.extractText(html)].join('\n');

      // Try to extract multiple flights (round-trip, multi-leg)
      const flights = this.parseMultipleFlights(source);

      logger.info(
        {
          flightCount: flights.length,
          flights: flights.map(f => ({
            flightNumber: f.flightNumber,
            route: `${f.departureCode} → ${f.arrivalCode}`,
            missing: f.missing.length,
          })),
        },
        '[Regex Parser] Parsing complete'
      );

      return flights;
    } catch (error) {
      logger.error({ error, subject }, '[Regex Parser] Unexpected error during parsing');
      throw error;
    }
  }

  /**
   * Extract text from HTML
   */
  private extractText(html?: string): string {
    if (!html) return '';
    try {
      const root = parse(html);
      return root.text || '';
    } catch (error) {
      logger.warn({ error, htmlLength: html.length }, '[Regex Parser] HTML text extraction failed, proceeding without HTML content');
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
   * Check if an IATA code is valid (common airports only)
   * This helps filter out false positives like "OGO", "CRA", etc.
   */
  private isValidIATACode(code: string): boolean {
    const commonValidCodes = new Set([
      // Major European airports
      'MUC', 'FRA', 'BER', 'HAM', 'DUS', 'CGN', 'STR', 'HAJ', 'NUE', 'LEJ', 'DRS', 'BRE',
      'LUX', 'CDG', 'ORY', 'LHR', 'LGW', 'STN', 'AMS', 'BRU', 'VIE', 'ZRH', 'GVA',
      'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'CPH', 'ARN', 'OSL', 'PRG', 'WAW', 'BUD', 'IST', 'ATH',
      'HEL', 'DUB', 'EDI', 'MAN', 'BHX', 'BRS', 'NCL', 'LPL', 'EMA', 'SOU',
      // DACH airports
      'SZG', 'GRZ', 'INN', 'LNZ', 'BSL', 'BRN',
      // Major US airports
      'JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'ORD', 'DFW', 'DEN', 'ATL', 'MIA', 'SEA', 'BOS', 'IAD', 'DCA',
      'PHX', 'LAS', 'MCO', 'CLT', 'DTW', 'PHL', 'MSP', 'BWI', 'SLC', 'HNL',
      // Major Asian airports
      'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'HKG', 'SIN', 'BKK', 'KUL', 'DXB', 'DOH', 'AUH',
      'KIX', 'TPE', 'MNL', 'CGK', 'BOM', 'DEL', 'CCU', 'MAA', 'BLR', 'HYD',
      // Major airports in other regions
      'SYD', 'MEL', 'BNE', 'PER', 'ADL', 'AKL', 'WLG', 'YVR', 'YYZ', 'YUL', 'YOW', 'YEG', 'YYC',
      'GRU', 'GIG', 'EZE', 'SCL', 'LIM', 'BOG', 'MEX', 'CUN', 'PTY', 'SJO',
      'JNB', 'CPT', 'CAI', 'NBO', 'LOS', 'ACC', 'ADD', 'CMN', 'TUN', 'ALG',
    ]);
    return commonValidCodes.has(code.toUpperCase());
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

    // Filter out false positives (common German words and invalid codes)
    const falsePositives = [
      'UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'FUR', 'MIT', 'AUF', 'AUS',
      'FUR', 'FÜR', 'EIN', 'EINE', 'EINER', 'EINEM', 'EINEN', 'EINES',
      'OGO', 'CRA', 'DAN', 'VIEL', 'DANK', 'SEHR', 'WICHT', 'BEST',
      'GRU', 'HER', 'FRE', 'SCH', 'GUT', 'NEU', 'ALT', 'GRO', 'KLE',
      'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
      'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW',
      'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY',
      'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'YET', 'ZUR',
    ];
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
   * Parse multiple flights from email (round-trip, multi-leg)
   */
  private parseMultipleFlights(source: string): ParsedBooking[] {
    const flights: ParsedBooking[] = [];
    const sourceUpper = source.toUpperCase();

    // Extract all flight numbers with context
    const flightNumberPatterns = [
      /(?:FLIGHT|FLUG|FLUGNUMMER|FLUG-NR|FLT\.?)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/gi,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*(?:FLIGHT|FLUG|DEPARTURE|ABFLUG|BOARDING|GATE|TERMINAL))/gi,
    ];

    const flightNumbers: Array<{ number: string; index: number }> = [];
    for (const pattern of flightNumberPatterns) {
      const matches = Array.from(source.matchAll(pattern));
      for (const match of matches) {
        const potential = (match[1] + (match[2] || '')).replace(/\s+/g, '');
        if (/^[A-Z]{2,3}\d{2,4}$/.test(potential)) {
          const falsePositives = ['AM', 'PM', 'VI', 'AN', 'IN', 'ON', 'AT', 'TO', 'OF', 'OR', 'IS', 'AS', 'BE', 'WE', 'HE', 'ME', 'MY', 'BY', 'GO', 'NO', 'SO', 'UP', 'US', 'IT', 'IF', 'DO', 'OK', 'HI', 'OH', 'AH', 'EH', 'UM', 'ER', 'OR', 'UR', 'YA', 'YE', 'YO', 'ZA', 'ZE', 'ZO'];
          if (!falsePositives.includes(potential.slice(0, 2))) {
            flightNumbers.push({ number: potential, index: match.index || 0 });
          }
        }
      }
    }

    // Remove duplicates and sort by position
    const uniqueFlights = Array.from(
      new Map(flightNumbers.map(f => [f.number, f])).values()
    ).sort((a, b) => a.index - b.index);

    // Extract all airport code pairs
    const airportPairs = this.extractAllAirportPairs(source);

    // Extract all date/time pairs
    const timePairs = this.extractAllTimePairs(source);

    // Extract shared PNR (should be same for all flights in one booking)
    const sharedPnr = this.extractSharedPNR(source);

    // If we found multiple flight numbers, try to match them with routes
    if (uniqueFlights.length > 1) {
      logger.debug(`[Regex Parser] Found ${uniqueFlights.length} potential flights`);

      // Try to match each flight number with a route
      for (let i = 0; i < uniqueFlights.length; i++) {
        const flightNum = uniqueFlights[i].number;
        const flightData: Partial<ParsedBooking> = {
          flightNumber: flightNum,
          airline: flightNum.slice(0, 2),
          pnr: sharedPnr,
          bookingReference: sharedPnr,
        };

        // Try to find route for this flight (use airport pairs in order)
        if (airportPairs.length > i) {
          const departure = airportPairs[i].departure;
          const arrival = airportPairs[i].arrival;
          flightData.departureCode = departure && this.isValidIATACode(departure)
            ? departure
            : undefined;
          flightData.arrivalCode = arrival && this.isValidIATACode(arrival)
            ? arrival
            : undefined;
        }

        // Try to find time for this flight
        if (timePairs.length > i) {
          flightData.departureTime = timePairs[i].departure;
          flightData.arrivalTime = timePairs[i].arrival;
        }

        const parsed = normalizeParsedBooking(flightData);
        if (parsed.flightNumber) {
          flights.push(parsed);
        }
      }
    }

    // If we found multiple airport pairs but only one flight number, it might be a round-trip
    if (flights.length === 0 && airportPairs.length >= 2) {
      logger.debug(`[Regex Parser] Found ${airportPairs.length} airport pairs, treating as round-trip`);

      for (let i = 0; i < airportPairs.length; i++) {
        const pair = airportPairs[i];
        if (pair.departure && pair.arrival &&
            this.isValidIATACode(pair.departure) &&
            this.isValidIATACode(pair.arrival)) {
          const flightData: Partial<ParsedBooking> = {
            departureCode: pair.departure,
            arrivalCode: pair.arrival,
            pnr: sharedPnr,
            bookingReference: sharedPnr,
          };

          // Use first flight number for all, or try to find specific one
          if (uniqueFlights.length > 0) {
            flightData.flightNumber = uniqueFlights[Math.min(i, uniqueFlights.length - 1)].number;
            flightData.airline = flightData.flightNumber.slice(0, 2);
          }

          if (timePairs.length > i) {
            flightData.departureTime = timePairs[i].departure;
            flightData.arrivalTime = timePairs[i].arrival;
          }

          flights.push(normalizeParsedBooking(flightData));
        }
      }
    }

    // Fallback to single flight parsing if no multi-flight pattern detected
    if (flights.length === 0) {
      const singleFlight = this.parseBookingEmailRegex(source);
      return [singleFlight];
    }

    return flights;
  }

  /**
   * Extract all airport code pairs from text
   */
  private extractAllAirportPairs(source: string): Array<{ departure?: string; arrival?: string }> {
    const pairs: Array<{ departure?: string; arrival?: string }> = [];
    const sourceLower = source.toLowerCase();
    const sourceUpper = source.toUpperCase();

    // Pattern 1: City names (von X nach Y)
    const cityPattern = /(?:von|ab|from)\s+([\p{L}\s-]+?)\s+(?:nach|to|bis)\s+([\p{L}\s-]+?)(?:\s+am|\s+on|\s+\d|$|\n)/giu;
    let cityMatch;
    while ((cityMatch = cityPattern.exec(sourceLower)) !== null) {
      const depCity = this.normalizeCityName(cityMatch[1]);
      const arrCity = this.normalizeCityName(cityMatch[2]);
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
      if (this.isValidIATACode(dep) && this.isValidIATACode(arr)) {
        pairs.push({ departure: dep, arrival: arr });
      }
    }

    // Pattern 3: Sequential IATA codes (MUC FRA LUX)
    const sequentialPattern = /\b([A-Z]{3})\s+([A-Z]{3})\b/g;
    const codes: string[] = [];
    let seqMatch;
    while ((seqMatch = sequentialPattern.exec(sourceUpper)) !== null) {
      if (this.isValidIATACode(seqMatch[1]) && this.isValidIATACode(seqMatch[2])) {
        codes.push(seqMatch[1], seqMatch[2]);
      }
    }

    // Group sequential codes into pairs
    for (let i = 0; i < codes.length - 1; i += 2) {
      pairs.push({ departure: codes[i], arrival: codes[i + 1] });
    }

    return pairs;
  }

  /**
   * Extract all date/time pairs from text
   */
  private extractAllTimePairs(source: string): Array<{ departure?: string; arrival?: string }> {
    const pairs: Array<{ departure?: string; arrival?: string }> = [];

    // ISO format dates — TZ offset/Z suffix is consumed but not captured (local time kept)
    const isoPattern = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g;
    const isoMatches = Array.from(source.matchAll(isoPattern));
    const isoDates = isoMatches.map(m => m[1].replace(' ', 'T'));

    // Group into pairs (departure, arrival)
    for (let i = 0; i < isoDates.length; i += 2) {
      pairs.push({
        departure: isoDates[i],
        arrival: isoDates[i + 1],
      });
    }

    // German/English date format — abbreviated and full month names, time optional
    const germanPattern = /(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/gi;
    const germanMatches = Array.from(source.matchAll(germanPattern));

    for (const match of germanMatches) {
      const day = match[1].padStart(2, '0');
      const raw = match[2].toUpperCase();
      const month = MONTH_NAMES[raw] ?? (match[2].length <= 2 ? match[2].padStart(2, '0') : '01');
      const year = match[3];
      const hour = match[4] ? match[4].padStart(2, '0') : '00';
      const minute = match[5] ?? '00';
      let isoTime = `${year}-${month}-${day}T${hour}:${minute}`;

      // Detect +N next-day marker (e.g. "+1", "(+1)") — exclude timezone offsets like +01:00
      const after = source.slice(match.index! + match[0].length, match.index! + match[0].length + 8);
      const nextDay = after.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
      if (nextDay) isoTime = addDays(isoTime, Number(nextDay[1]));

      // Add to pairs (assume first is departure, second is arrival)
      const existingPair = pairs.find(p => !p.departure);
      if (existingPair) {
        existingPair.departure = isoTime;
      } else {
        pairs.push({ departure: isoTime });
      }
    }

    return pairs;
  }

  /**
   * Find the first PNR candidate in an already-uppercased source string.
   * A PNR is a 6-char alphanumeric token that contains at least one digit
   * and is not a known German false-positive word.
   */
  private findPNRInSource(sourceUpper: string): string | undefined {
    for (const match of sourceUpper.matchAll(/\b([A-Z0-9]{6})\b/g)) {
      const pnr = match[1];
      if (!PNR_FALSE_POSITIVES.has(pnr) && /[0-9]/.test(pnr)) {
        return pnr;
      }
    }
    return undefined;
  }

  /**
   * Extract shared PNR (should be same for all flights)
   */
  private extractSharedPNR(source: string): string | undefined {
    return this.findPNRInSource(source.toUpperCase());
  }

  /**
   * Parse booking email using regex patterns (single flight)
   */
  private parseBookingEmailRegex(source: string): ParsedBooking {
    const sourceUpper = source.toUpperCase();
    const data: Partial<ParsedBooking> = {};

    // Flight number - improved pattern to avoid false matches
    // Must be in context of "Flight", "LH", or near airport codes
    // Avoid matching "AM18" from "am 18 September" by requiring context
    const flightPatterns = [
      /(?:FLIGHT|FLUG|FLUGNUMMER|FLUG-NR|FLT\.?)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/i,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*(?:FLIGHT|FLUG|DEPARTURE|ABFLUG|BOARDING|GATE|TERMINAL))/i,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*[A-Z]{3}.*[A-Z]{3})/i, // Near airport codes
    ];

    let flightMatch: RegExpMatchArray | null = null;
    for (const pattern of flightPatterns) {
      flightMatch = source.match(pattern);
      if (flightMatch) {
        // Validate it's not a false positive (e.g., "AM18" from "am 18")
        const potentialFlight = (flightMatch[1] + (flightMatch[2] || '')).replace(/\s+/g, '');
        // Common false positives to exclude
        const falsePositives = ['AM', 'PM', 'VI', 'AN', 'IN', 'ON', 'AT', 'TO', 'OF', 'OR', 'IS', 'AS', 'BE', 'WE', 'HE', 'ME', 'MY', 'BY', 'GO', 'NO', 'SO', 'UP', 'US', 'IT', 'IF', 'DO', 'OK', 'HI', 'OH', 'AH', 'EH', 'UM', 'ER', 'OR', 'UR', 'YA', 'YE', 'YO', 'ZA', 'ZE', 'ZO'];
        if (!falsePositives.includes(potentialFlight.slice(0, 2))) {
          data.flightNumber = potentialFlight;
          data.airline = potentialFlight.slice(0, 2);
          break;
        }
      }
    }

    // If no match found, try the original pattern but with stricter validation
    if (!data.flightNumber) {
      const basicMatch = sourceUpper.match(PATTERNS.FLIGHT_NUMBER);
      if (basicMatch) {
        const potential = basicMatch[1].replace(/\s+/g, '');
        // Only accept if it looks like a real flight number (airline code + 2-4 digits)
        if (/^[A-Z]{2,3}\d{2,4}$/.test(potential)) {
          const airlineCode = potential.slice(0, 2);
          const falsePositives = ['AM', 'PM', 'VI', 'AN', 'IN', 'ON', 'AT', 'TO', 'OF', 'OR', 'IS', 'AS', 'BE', 'WE', 'HE', 'ME', 'MY', 'BY', 'GO', 'NO', 'SO', 'UP', 'US', 'IT', 'IF', 'DO', 'OK', 'HI', 'OH', 'AH', 'EH', 'UM', 'ER', 'OR', 'UR', 'YA', 'YE', 'YO', 'ZA', 'ZE', 'ZO'];
          if (!falsePositives.includes(airlineCode)) {
            data.flightNumber = potential;
            data.airline = airlineCode;
          }
        }
      }
    }

    // PNR - delegate to shared extraction logic
    const pnr = this.findPNRInSource(sourceUpper);
    if (pnr) {
      data.pnr = pnr;
      data.bookingReference = pnr;
    }

    // Airports
    const { departure, arrival } = this.extractAirportCodes(source);
    // Validate airport codes against whitelist to filter false positives
    data.departureCode = departure && this.isValidIATACode(departure) ? departure : undefined;
    data.arrivalCode = arrival && this.isValidIATACode(arrival) ? arrival : undefined;

    // Times - improved extraction with multiple formats
    // ISO format — TZ offset/Z suffix consumed but not captured (local time kept)
    const isoTimeMatches = Array.from(
      source.matchAll(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g)
    );
    if (isoTimeMatches.length >= 1) data.departureTime = isoTimeMatches[0][1].replace(' ', 'T');
    if (isoTimeMatches.length >= 2) data.arrivalTime = isoTimeMatches[1][1].replace(' ', 'T');

    // German/English date format — abbreviated and full month names, time optional
    if (!data.departureTime || !data.arrivalTime) {
      const germanDatePattern = /(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/gi;
      const dateMatches = Array.from(source.matchAll(germanDatePattern));
      const toIso = (m: RegExpMatchArray, src: string): string => {
        const d = m[1].padStart(2, '0');
        const raw = m[2].toUpperCase();
        const mo = MONTH_NAMES[raw] ?? (m[2].length <= 2 ? m[2].padStart(2, '0') : '01');
        const y = m[3];
        const h = m[4] ? m[4].padStart(2, '0') : '00';
        const min = m[5] ?? '00';
        let iso = `${y}-${mo}-${d}T${h}:${min}`;
        // Detect +N next-day marker — exclude timezone offsets like +01:00
        const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
        const nextDay = after.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
        if (nextDay) iso = addDays(iso, Number(nextDay[1]));
        return iso;
      };
      if (dateMatches.length > 0) {
        if (!data.departureTime) data.departureTime = toIso(dateMatches[0], source);
        if (!data.arrivalTime && dateMatches.length > 1) data.arrivalTime = toIso(dateMatches[1], source);
      }
    }

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

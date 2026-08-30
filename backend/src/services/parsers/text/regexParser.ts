import { parse } from 'node-html-parser';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, PATTERNS } from '../shared/utils';
import logger from '../../../utils/logger';

import { FLIGHT_NUMBER_FALSE_PREFIXES } from './regexMappings';
import { extractAirportCodes, extractAllAirportPairs, isValidIATACode } from './regexAirportExtractor';
import { extractAllTimePairs, extractLabeledDates } from './regexDateExtractor';
import { extractSharedPNR, findPNRInSource } from './regexPnrExtractor';

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
   * Parse multiple flights from email (round-trip, multi-leg)
   */
  private parseMultipleFlights(source: string): ParsedBooking[] {
    const flights: ParsedBooking[] = [];

    // Extract all flight numbers with context
    const flightNumberPatterns = [
      /(?:FLIGHT|FLUG|FLUGNUMMER|FLUGNR\.?|FLUG-NR|FLT\.?)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/gi,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*(?:FLIGHT|FLUG|DEPARTURE|ABFLUG|BOARDING|GATE|TERMINAL))/gi,
    ];

    const flightNumbers: Array<{ number: string; index: number }> = [];
    for (const pattern of flightNumberPatterns) {
      const matches = Array.from(source.matchAll(pattern));
      for (const match of matches) {
        const potential = (match[1] + (match[2] || '')).replace(/\s+/g, '');
        if (/^[A-Z]{2,3}\d{2,4}$/.test(potential)) {
          if (!FLIGHT_NUMBER_FALSE_PREFIXES.includes(potential.slice(0, 2))) {
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
    const airportPairs = extractAllAirportPairs(source);

    // Extract all date/time pairs
    const timePairs = extractAllTimePairs(source);

    // Extract shared PNR (should be same for all flights in one booking)
    const sharedPnr = extractSharedPNR(source);

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
          flightData.departureCode = departure && isValidIATACode(departure)
            ? departure
            : undefined;
          flightData.arrivalCode = arrival && isValidIATACode(arrival)
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
            isValidIATACode(pair.departure) &&
            isValidIATACode(pair.arrival)) {
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

      /**
       * A candidate needs SOMETHING that identifies a flight.
       *
       * This branch used to return its result unconditionally, so any text at
       * all became one booking. Forgejo #17: an Emirates promotion and an
       * American Airlines holiday greeting each came back as a flight — one
       * with no flight number and no route at all, just a date scraped out of
       * the prose, and the UI then opened a review form over it instead of
       * saying no booking was found.
       *
       * A flight number, or both ends of a route. A date alone is not evidence:
       * every marketing email carries one.
       */
      const hasFlightNumber = Boolean(singleFlight.flightNumber);
      const hasRoute = Boolean(singleFlight.departureCode && singleFlight.arrivalCode);
      if (!hasFlightNumber && !hasRoute) {
        logger.debug({
          operation: 'regex_parser_no_evidence',
          message: 'Discarded a candidate with neither a flight number nor a route',
        });
        return [];
      }

      return [singleFlight];
    }

    return flights;
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
      // Tab-delimited standalone airline code — old Buchungsdetails format (e.g. "\tLH 2316\t")
      /[\t >]([A-Z]{2}\s+\d{3,4})(?:[\t \r\n]|$)/m,
      /(?:FLIGHT|FLUG|FLUGNUMMER|FLUGNR\.?|FLUG-NR|FLT\.?)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/i,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*(?:FLIGHT|FLUG|DEPARTURE|ABFLUG|BOARDING|GATE|TERMINAL))/i,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=.*[A-Z]{3}.*[A-Z]{3})/i, // Near airport codes
    ];

    let flightMatch: RegExpMatchArray | null = null;
    for (const pattern of flightPatterns) {
      flightMatch = source.match(pattern);
      if (flightMatch) {
        // Validate it's not a false positive (e.g., "AM18" from "am 18").
        //
        // Uppercased BEFORE the check, and that is the whole fix: the patterns
        // above carry /i and run over `source` in its original case, so an
        // advertisement's "ab 380 EUR" arrives here as "ab380".
        // FLIGHT_NUMBER_FALSE_PREFIXES lists "AB" — and "ab" is not "AB", so the
        // guard that was written for exactly this case never fired. Six of the
        // eight archived Emirates promotions became a flight this way (Forgejo
        // #35), and the evidence rule cannot catch them: a flight number is
        // precisely what the advertising manufactures.
        //
        // The multi-flight path above rejects a lowercase candidate outright via
        // its /^[A-Z]{2,3}\d{2,4}$/ test, which is why only this branch leaked.
        const potentialFlight = (flightMatch[1] + (flightMatch[2] || ''))
          .replace(/\s+/g, '')
          .toUpperCase();
        // The WHOLE alphabetic prefix, not the first two characters: an airline
        // code may be two or three letters, and slicing at two let "Nur 7 Tage
        // gültig" through as NUR7 because the guard only ever saw "NU".
        const prefix = /^[A-Z]+/.exec(potentialFlight)?.[0] ?? '';
        if (!FLIGHT_NUMBER_FALSE_PREFIXES.includes(prefix)) {
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
          if (!FLIGHT_NUMBER_FALSE_PREFIXES.includes(airlineCode)) {
            data.flightNumber = potential;
            data.airline = airlineCode;
          }
        }
      }
    }

    // PNR - delegate to shared extraction logic
    const pnr = findPNRInSource(sourceUpper);
    if (pnr) {
      data.pnr = pnr;
      data.bookingReference = pnr;
    }

    // Airports
    const { departure, arrival } = extractAirportCodes(source);
    // Validate airport codes against whitelist to filter false positives
    data.departureCode = departure && isValidIATACode(departure) ? departure : undefined;
    data.arrivalCode = arrival && isValidIATACode(arrival) ? arrival : undefined;

    // Times — label-based first (Option A), positional fallback
    const labeled = extractLabeledDates(source);
    if (labeled.departureTime) data.departureTime = labeled.departureTime;
    if (labeled.arrivalTime) data.arrivalTime = labeled.arrivalTime;

    if (!data.departureTime || !data.arrivalTime) {
      // ISO format — TZ offset/Z suffix consumed but not captured (local time kept)
      const isoTimeMatches = Array.from(
        source.matchAll(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g)
      );
      if (!data.departureTime && isoTimeMatches.length >= 1) data.departureTime = isoTimeMatches[0][1].replace(' ', 'T');
      if (!data.arrivalTime && isoTimeMatches.length >= 2) data.arrivalTime = isoTimeMatches[1][1].replace(' ', 'T');
    }

    // German/English date format — delegates to the shared extractor, which
    // validates month names, applies the plausible-year window, supports
    // two-digit years, and associates column-layout times (time line above
    // the date line). The previous inline copy defaulted unknown months to
    // '01' and required four-digit years — both bugs the extractor fixes.
    if (!data.departureTime || !data.arrivalTime) {
      const germanPairs = extractAllTimePairs(source);
      if (germanPairs.length > 0) {
        if (!data.departureTime) data.departureTime = germanPairs[0].departure;
        if (!data.arrivalTime) {
          data.arrivalTime = germanPairs[0].arrival ?? germanPairs[1]?.departure;
        }
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

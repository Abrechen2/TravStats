import { parse } from "node-html-parser";
import { ITextParser, ProviderAvailability, TextProvider } from "../types";
import { ParsedBooking } from "../../bookingParser";
import { normalizeParsedBooking, PATTERNS } from "../shared/utils";
import logger from "../../../utils/logger";

import { FLIGHT_NUMBER_FALSE_PREFIXES } from "./regexMappings";
import { resolveAirlineCodes } from "../../../utils/airlineNormalize";
import {
  extractAirportCodes,
  extractAllAirportPairs,
  isValidIATACode,
} from "./regexAirportExtractor";
import { extractAllTimePairs, extractLabeledDates } from "./regexDateExtractor";
import { extractSharedPNR } from "./regexPnrExtractor";
import { isPriceNotFlightNumber } from "../shared/evidence";

type RouteShape = "absent" | "complete" | "broken";

/**
 * A leg's route is absent (neither end), complete (two DIFFERENT known
 * airports, compared case-insensitively), or broken — one end only, an end
 * that is no known airport, or the same airport twice. A broken route is a
 * wrong read, not a partial one: the corpus turned tour-operator invoices into
 * "WHO→WHO" and an Egyptair e-ticket into "EMD→EMD" exactly this way.
 */
function routeShape(f: ParsedBooking): RouteShape {
  const dep = f.departureCode;
  const arr = f.arrivalCode;
  if (!dep && !arr) return "absent";
  if (!dep || !arr) return "broken";
  if (!isValidIATACode(dep) || !isValidIATACode(arr)) return "broken";
  return dep.toUpperCase() === arr.toUpperCase() ? "broken" : "complete";
}

/**
 * The generic reader knows no sender, so a leg counts only when it can defend
 * itself: it carries a flight number OR a complete route — and a route, once
 * either end is there, must be complete (see {@link routeShape}).
 *
 * Why not more:
 * - No date. `parsers.text.test.ts` pins that "FRA → JFK" alone, and a
 *   flight number with its route but no date, are candidates — a confirmation
 *   that names only the airports is common, and dropping it trades one silent
 *   failure for another. Requiring a date here broke exactly those (Task 6
 *   measurement, 2026-09-30).
 * - No route for a flight number. A number without a route is INCOMPLETE, not
 *   wrong: the flight lookup fills the route in later. Whether a LONE such
 *   number is a flight at all is decided by the #291 second-witness gate in
 *   `shared/evidence.ts`, which reads the mail's text this function never sees.
 *
 * What a single leg cannot show — a number paired with the wrong route — is
 * decided per document in `withEvidence`.
 */
export function segmentHasEvidence(f: ParsedBooking): boolean {
  const shape = routeShape(f);
  if (shape === "broken") return false;
  return shape === "complete" || Boolean(f.flightNumber);
}

/**
 * Why a document is declined whole, or null when it stands. For one leg this
 * is just {@link segmentHasEvidence}; the other checks need two legs.
 *
 * The multi-leg paths pair flight numbers with routes and dates by POSITION,
 * so a document is only as good as that pairing. Two shapes show it failed:
 * - routed and route-less legs mixed (Emirates: the outbound route printed,
 *   the onward legs' not) — which number the one route belongs to is a guess;
 * - one flight number on two different routes (Lufthansa connection: one
 *   number found for two routes, and the return leg's number handed to the
 *   outbound leg too) — a confidently wrong number, worse than none;
 * - departures that run backwards ({@link datesRunForward});
 * - legs with a route but no flight number. Alone, "FRA → JFK" is a candidate;
 *   several of them were, in all six tour-operator invoices of the 2026-09-30
 *   corpus, an itinerary's coded stops paired with times by position — every
 *   one wrong (Hurghada read as Cairo, onward legs missing, a later leg's
 *   time). Without a number nothing ties a route to its time, and the lookup
 *   has nothing to repair it from.
 *
 * Exported for its tests: the mixed shape can no longer be produced from text
 * by this reader (routes are only paired one per number), but the check stays
 * as the guard should a pairing path reintroduce it.
 */
export function documentDefect(flights: ParsedBooking[]): string | null {
  if (!flights.every(segmentHasEvidence)) return "leg_without_evidence";

  const shapes = new Set(flights.map(routeShape));
  if (shapes.has("complete") && shapes.has("absent")) return "mixed_routed_and_routeless_legs";
  if (flights.length > 1 && flights.some((f) => !f.flightNumber)) {
    return "route_only_legs_in_multi_leg_document";
  }

  const routesByNumber = new Map<string, Set<string>>();
  for (const f of flights) {
    if (!f.flightNumber) continue;
    const route = `${f.departureCode ?? ""}>${f.arrivalCode ?? ""}`.toUpperCase();
    const key = f.flightNumber.toUpperCase();
    routesByNumber.set(key, new Set([...(routesByNumber.get(key) ?? []), route]));
  }
  const repeated = [...routesByNumber.values()].some((routes) => routes.size > 1);
  if (repeated) return "flight_number_on_two_routes";

  return datesRunForward(flights) ? null : "legs_out_of_date_order";
}

/**
 * Legs are read in travel order, so their departures must not go backwards.
 * An undated leg is skipped, not counted against the order. Invoice 1C895383
 * (corpus 2026-09-30) dated its return leg eight months before the outbound —
 * a date taken from elsewhere in the document and paired by position.
 */
function datesRunForward(flights: ParsedBooking[]): boolean {
  const times = flights
    .map((f) => (f.departureTime ? Date.parse(f.departureTime) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  return times.every((t, i) => i === 0 || t >= times[i - 1]);
}

/**
 * Whether a candidate's digits are the DAY of a dotted date that continues
 * right after it — "MR 24.11.2031", a passenger's title before the travel
 * date in an agency's invoice subject. Measured 2026-10-01 on a private
 * mailbox: six such subjects of one OTA read as flight "MR24" and the like. A
 * printed flight number is never followed by ".month.year".
 */
function isDayOfDottedDate(source: string, matchEnd: number): boolean {
  return /^\.\d{1,2}\.\d{2,4}\b/.test(source.slice(matchEnd, matchEnd + 12));
}

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
  readonly provider: TextProvider = "regex";

  async checkAvailability(): Promise<ProviderAvailability> {
    // Regex parser is always available
    return {
      available: true,
      metadata: {
        provider: "regex",
        description: "Pattern-based email parsing",
        cost: "free",
      },
    };
  }

  async parseEmail(subject: string, text: string, html?: string): Promise<ParsedBooking[]> {
    logger.info("[Regex Parser] Starting email parsing");

    try {
      const source = [subject || "", text || "", this.extractText(html)].join("\n");

      // Try to extract multiple flights (round-trip, multi-leg)
      const flights = this.parseMultipleFlights(source);

      logger.info(
        { flightCount: flights.length, missing: flights.map((f) => f.missing.length) },
        "[Regex Parser] Parsing complete"
      );
      logger.debug(
        {
          flights: flights.map((f) => ({
            flightNumber: f.flightNumber,
            route: `${f.departureCode} → ${f.arrivalCode}`,
          })),
        },
        "[Regex Parser] Parsing complete"
      );

      return flights;
    } catch (error) {
      logger.error({ error }, "[Regex Parser] Unexpected error during parsing");
      logger.debug({ subject }, "[Regex Parser] Unexpected error during parsing");
      throw error;
    }
  }

  /**
   * Extract text from HTML
   */
  private extractText(html?: string): string {
    if (!html) return "";
    try {
      const root = parse(html);
      return root.text || "";
    } catch (error) {
      logger.warn(
        { error, htmlLength: html.length },
        "[Regex Parser] HTML text extraction failed, proceeding without HTML content"
      );
      return "";
    }
  }

  /**
   * The one gate every result of this reader passes (`parseEmail` is its only
   * entry point, and both return paths of `parseMultipleFlights` end here).
   *
   * One candidate stands when {@link segmentHasEvidence} says so — a
   * same-airport or half route declines it; a route-less flight number is
   * returned and left to the #291 second-witness gate in `shared/evidence.ts`.
   * Several legs stand only together: see {@link documentDefect}.
   */
  private withEvidence(flights: ParsedBooking[]): ParsedBooking[] {
    if (flights.length === 0) return [];

    const reason = documentDefect(flights);
    if (reason === null) return flights;

    logger.debug({
      operation: "regex_parser_insufficient_evidence",
      reason,
      legs: flights.length,
    });
    return [];
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
        const potential = (match[1] + (match[2] || "")).replace(/\s+/g, "");
        // A price is dropped HERE, before pairing. Dropped only afterwards (by
        // the evidence gate in `email.ts`), "CHF 120 inkl. Flughafensteuer" —
        // the lookahead finds "Flug" in "Flughafensteuer" — had already taken
        // a positional slot: the first route went to CHF120, the real number
        // got the next one. NOT the airline catalogue: asking it here dropped
        // a real carrier the catalogue lacks, left its legs route-only, and
        // the document was declined — a real flight lost (owner, 2026-10-01).
        if (
          /^[A-Z]{2,3}\d{2,4}$/.test(potential) &&
          !isDayOfDottedDate(source, (match.index ?? 0) + match[0].length) &&
          !FLIGHT_NUMBER_FALSE_PREFIXES.includes(potential.slice(0, 2)) &&
          !isPriceNotFlightNumber(potential)
        ) {
          flightNumbers.push({ number: potential, index: match.index || 0 });
        }
      }
    }

    // Remove duplicates and sort by position
    const uniqueFlights = Array.from(
      new Map(flightNumbers.map((f) => [f.number, f])).values()
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

        // Routes go to numbers by position ONLY when there is one route per
        // number. With fewer (or more) routes the pairing is a guess: the
        // Emirates layout yields one pair — its itinerary summary line,
        // "MUC SYD" — for four numbers, and the first number took a route that
        // is not its own. Every leg stays route-less then; the lookup fills it.
        if (airportPairs.length === uniqueFlights.length) {
          const departure = airportPairs[i].departure;
          const arrival = airportPairs[i].arrival;
          flightData.departureCode =
            departure && isValidIATACode(departure) ? departure : undefined;
          flightData.arrivalCode = arrival && isValidIATACode(arrival) ? arrival : undefined;
        }

        // Times follow the same one-to-one rule as routes. "At least as many
        // pairs as numbers" let one extra pair above the itinerary — a
        // document's creation stamp — shift every leg: the first flight took
        // the stamp, the second the first flight's time. Undated legs are
        // completed by the lookup; a wrong date is not.
        if (timePairs.length === uniqueFlights.length) {
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
      logger.debug(
        `[Regex Parser] Found ${airportPairs.length} airport pairs, treating as round-trip`
      );

      for (let i = 0; i < airportPairs.length; i++) {
        const pair = airportPairs[i];
        if (
          pair.departure &&
          pair.arrival &&
          isValidIATACode(pair.departure) &&
          isValidIATACode(pair.arrival)
        ) {
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

          // One time pair per route, or none at all — as for numbers above.
          if (timePairs.length === airportPairs.length) {
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
          operation: "regex_parser_no_evidence",
          message: "Discarded a candidate with neither a flight number nor a route",
        });
        return [];
      }

      return this.withEvidence([singleFlight]);
    }

    return this.withEvidence(flights);
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
      // Case-SENSITIVE, and the lookahead spans lines. Both matter, and both
      // were wrong in a way that inverted this pattern's purpose:
      //
      // `.` does not cross a newline. A confirmation prints its flight number
      // alone on a line ("EK0050"), so there is nothing after it ON THAT LINE
      // for the lookahead to find and the real flight never matched. The very
      // next line, "Mo  24-Feb-14 … Franz Josef Strauß - Flughafen (MUC)", DOES
      // contain "Flug" — inside "Flughafen" — so the German weekday matched
      // instead and the document was booked as flight MO24. The context rule
      // was systematically preferring prose lines over the flight lines.
      //
      // The /i flag was the other half: it let "Mo" and even "fly4" out of a
      // URL count as an airline code. A printed flight number is uppercase.
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=[\s\S]*(?:FLIGHT|FLUG|DEPARTURE|ABFLUG|BOARDING|GATE|TERMINAL))/,
      /\b([A-Z]{2,3})\s*(\d{1,4})\b(?=[\s\S]*[A-Z]{3}[\s\S]*[A-Z]{3})/, // Near airport codes
    ];

    // EVERY match of every pattern, in pattern order, not the first match of the
    // first pattern that hits. Taking the first hit meant the winner was decided
    // by position in the document: on an Emirates confirmation "EUR 934,00" is
    // printed above the itinerary, so the price won and the flight below it was
    // never considered.
    const candidates: string[] = [];
    for (const pattern of flightPatterns) {
      const everyMatch = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
      );
      for (const match of source.matchAll(everyMatch)) {
        // Uppercased BEFORE the guard, and that alone fixed a whole class: the
        // patterns run over `source` in its original case, so an advertisement's
        // "ab 380 EUR" arrived as "ab380". FLIGHT_NUMBER_FALSE_PREFIXES lists
        // "AB" — and "ab" is not "AB", so a guard written for exactly this case
        // had never once fired.
        const candidate = (match[1] + (match[2] || "")).replace(/\s+/g, "").toUpperCase();
        if (!/^[A-Z]{2,3}\d{1,4}$/.test(candidate)) continue;
        if (isDayOfDottedDate(source, (match.index ?? 0) + match[0].length)) continue;
        // The WHOLE alphabetic prefix, not the first two characters: slicing at
        // two let "Nur 7 Tage gültig" through as NUR7 on a prefix of "NU".
        const prefix = /^[A-Z]+/.exec(candidate)?.[0] ?? "";
        if (!FLIGHT_NUMBER_FALSE_PREFIXES.includes(prefix)) candidates.push(candidate);
      }
    }

    // Prefer a candidate whose prefix is an airline the catalogue knows. A
    // blocklist can only ever name the noise someone has already seen; asking
    // "is this an airline" answers for the noise nobody has met yet. On the
    // archived corpus this is what finally picks EK0050 over EUR934 and MO24,
    // and AF1423 over "von 7".
    //
    // It is a preference, not a requirement: an airline missing from the
    // catalogue must still be able to produce a flight, so an unknown candidate
    // is used when there is no known one.
    const known = candidates.find((c) => resolveAirlineCodes(/^[A-Z]+/.exec(c)?.[0] ?? "")?.name);
    const chosen = known ?? candidates[0];
    if (chosen) {
      data.flightNumber = chosen;
      data.airline = chosen.slice(0, 2);
    }

    // If no match found, try the original pattern but with stricter validation
    if (!data.flightNumber) {
      const basicMatch = sourceUpper.match(PATTERNS.FLIGHT_NUMBER);
      if (
        basicMatch &&
        !isDayOfDottedDate(sourceUpper, (basicMatch.index ?? 0) + basicMatch[0].length)
      ) {
        const potential = basicMatch[1].replace(/\s+/g, "");
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

    // PNR - the labelled reference first ("Booking reference: QATEST1"), then
    // an unlabelled six-character code - but never the flight's own number:
    // "LH2230" is six characters with a digit, and the single-flight path
    // used to take it as the PNR (browser check of forgejo#159, 2026-10-02).
    const pnr = extractSharedPNR(source, data.flightNumber);
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

    // Positional fallback only when the document offers exactly ONE time
    // pair. This used to take "the first two ISO timestamps" (then the first
    // German pair, and the second pair's departure as an arrival), so a
    // creation stamp printed above the itinerary became the departure. With
    // several pairs and one flight, which pair is the flight's is a guess —
    // the same one-to-one rule the multi-leg path applies.
    if (!data.departureTime || !data.arrivalTime) {
      const pairs = extractAllTimePairs(source);
      if (pairs.length === 1) {
        data.departureTime ??= pairs[0].departure;
        data.arrivalTime ??= pairs[0].arrival;
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
      data.currency = "EUR";
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

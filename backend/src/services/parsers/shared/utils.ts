import { ParsedBooking } from '../../bookingParser';
import logger from '../../../utils/logger';
import { AIRLINE_IATA_MAP } from '../../../data/airlines';

/**
 * Get all available Claude models for text parsing, ordered by preference (newest first)
 * Returns the model from CLAUDE_MODEL env var if set, otherwise returns list of available models
 */
export function getClaudeTextModels(): string[] {
  // If explicitly set, use only that model
  if (process.env.CLAUDE_MODEL) {
    return [process.env.CLAUDE_MODEL];
  }

  // List of Claude models ordered by release date (newest first)
  // These are the most common models for text parsing
  // Update this list when new models are released
  return [
    'claude-3-5-sonnet-20241022', // Claude 3.5 Sonnet (October 2024 - latest stable)
    'claude-3-5-sonnet-20240620', // Claude 3.5 Sonnet (June 2024)
    'claude-3-opus-20240229',     // Claude 3 Opus (February 2024)
    'claude-3-sonnet-20240229',   // Claude 3 Sonnet (February 2024)
    'claude-3-haiku-20240307',    // Claude 3 Haiku (March 2024)
  ];
}

/**
 * Get the latest Claude model for text parsing
 * Returns the model from CLAUDE_MODEL env var if set, otherwise the latest available model
 * Models are ordered by release date (newest first)
 *
 * Note: Anthropic recommends using specific model versions for production.
 * This function returns the newest known model, but you can override it with CLAUDE_MODEL env var.
 */
export function getLatestClaudeTextModel(): string {
  const models = getClaudeTextModels();
  return models[0];
}

/**
 * Get all available Claude models for vision parsing, ordered by preference (newest first)
 * Returns the model from CLAUDE_VISION_MODEL env var if set, otherwise returns list of available models
 */
export function getClaudeVisionModels(): string[] {
  // If explicitly set, use only that model
  if (process.env.CLAUDE_VISION_MODEL) {
    return [process.env.CLAUDE_VISION_MODEL];
  }

  // List of Claude models with vision capabilities ordered by release date (newest first)
  // Update this list when new models are released
  return [
    'claude-3-5-sonnet-20241022', // Claude 3.5 Sonnet (October 2024 - latest stable with vision)
    'claude-3-5-sonnet-20240620', // Claude 3.5 Sonnet (June 2024)
    'claude-3-opus-20240229',     // Claude 3 Opus (February 2024)
    'claude-3-sonnet-20240229',   // Claude 3 Sonnet (February 2024)
    'claude-3-haiku-20240307',    // Claude 3 Haiku (March 2024)
  ];
}

/**
 * Get the latest Claude model for vision parsing
 * Returns the model from CLAUDE_VISION_MODEL env var if set, otherwise the latest available model
 *
 * Note: Anthropic recommends using specific model versions for production.
 * This function returns the newest known model, but you can override it with CLAUDE_VISION_MODEL env var.
 */
export function getLatestClaudeVisionModel(): string {
  const models = getClaudeVisionModels();
  return models[0];
}

/**
 * Common valid IATA airport codes (whitelist for validation)
 * This is a subset of the most common airports to filter out false positives
 */
const COMMON_VALID_IATA_CODES = new Set([
  // Major European airports
  'MUC', 'FRA', 'BER', 'HAM', 'DUS', 'CGN', 'STR', 'HAJ', 'NUE', 'LEJ', 'DRS', 'BRE',
  'LUX', 'CDG', 'ORY', 'LHR', 'LGW', 'STN', 'AMS', 'BRU', 'VIE', 'ZRH', 'GVA',
  'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'CPH', 'ARN', 'OSL', 'PRG', 'WAW', 'BUD', 'IST', 'ATH',
  'HEL', 'DUB', 'EDI', 'MAN', 'BHX', 'BRS', 'NCL', 'LPL', 'EMA', 'SOU',
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

/**
 * Validate IATA airport code (must be exactly 3 uppercase letters)
 * Optionally check against whitelist of common valid codes
 */
export function validateIATACode(code: string | null | undefined, strict: boolean = false): string | undefined {
  if (!code) return undefined;
  const cleaned = code.toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(cleaned)) return undefined;

  // If strict mode, check against whitelist of common valid codes
  if (strict && !COMMON_VALID_IATA_CODES.has(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * Validate and format flight number (airline code + number)
 * Examples: LH103, FR8234, BA472
 */
export function validateFlightNumber(flightNumber: string | null | undefined): string | undefined {
  if (!flightNumber) return undefined;
  const cleaned = flightNumber.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{2,3}\d{1,4}$/.test(cleaned) ? cleaned : undefined;
}

/**
 * Validate ISO 8601 datetime format
 */
export function validateDateTime(dateTime: string | null | undefined): string | undefined {
  if (!dateTime) return undefined;
  // Basic ISO 8601 validation (YYYY-MM-DDTHH:MM or YYYY-MM-DD HH:MM)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/.test(dateTime)) {
    return dateTime;
  }
  return undefined;
}

/**
 * Extract missing fields from parsed booking
 */
export function getMissingFields(booking: Partial<ParsedBooking>): string[] {
  const missing: string[] = [];

  if (!booking.flightNumber) missing.push('flightNumber');
  if (!booking.departureCode) missing.push('departureCode');
  if (!booking.arrivalCode) missing.push('arrivalCode');
  if (!booking.departureTime) missing.push('departureTime');
  if (!booking.arrivalTime) missing.push('arrivalTime');

  return missing;
}

/**
 * Clean and normalize parsed booking data
 */
export function normalizeParsedBooking(data: Record<string, unknown>): ParsedBooking {
  const missing = getMissingFields(data);

  const str = (val: unknown): string | undefined => typeof val === 'string' && val ? val : undefined;
  const strUp = (val: unknown): string | undefined => typeof val === 'string' && val ? val.toUpperCase() : undefined;
  const flightNum = str(data.flightNumber);

  const result: ParsedBooking = {
    airline: str(data.airline) || flightNum?.slice(0, 2).toUpperCase() || undefined,
    flightNumber: validateFlightNumber(str(data.flightNumber)),
    departureCode: validateIATACode(str(data.departureCode)),
    arrivalCode: validateIATACode(str(data.arrivalCode)),
    departureTime: validateDateTime(str(data.departureTime)),
    arrivalTime: validateDateTime(str(data.arrivalTime)),
    pnr: strUp(data.pnr) || strUp(data.bookingReference) || undefined,
    seat: strUp(data.seat) || undefined,
    terminal: str(data.terminal) || undefined,
    gate: strUp(data.gate) || undefined,
    price: data.price ? String(data.price) : undefined,
    currency: strUp(data.currency) || undefined,
    aircraft: str(data.aircraft) || undefined,
    seatClass: str(data.seatClass) || undefined,
    bookingReference: strUp(data.bookingReference) || strUp(data.pnr) || undefined,
    ticketNumber: str(data.ticketNumber) || undefined,
    boardingGroup: str(data.boardingGroup) || undefined,
    taxes: data.taxes ? String(data.taxes) : undefined,
    fees: data.fees ? String(data.fees) : undefined,
    missing,
  };

  // Log missing fields for debugging
  if (missing.length > 0) {
    logger.debug({
      flightNumber: result.flightNumber || 'UNKNOWN',
      missingFields: missing,
      rawData: {
        flightNumber: data.flightNumber,
        departureCode: data.departureCode,
        arrivalCode: data.arrivalCode,
        departureTime: data.departureTime,
        arrivalTime: data.arrivalTime,
      }
    }, '[Parser Utils] Normalized booking has missing fields');
  }

  return result;
}

/**
 * Extract airline code from flight number
 */
export function extractAirlineCode(flightNumber: string): string | undefined {
  const match = flightNumber.match(/^([A-Z]{2,3})\d+/);
  return match ? match[1] : undefined;
}

/**
 * Common regex patterns for flight data extraction
 */
export const PATTERNS = {
  FLIGHT_NUMBER: /\b([A-Z]{2,3}\s?\d{1,4})\b/,
  /** The same shape, every occurrence — see {@link pickFlightNumber}. */
  FLIGHT_NUMBER_ALL: /\b([A-Z]{2,3}\s?\d{1,4})\b/g,
  IATA_CODE: /\b([A-Z]{3})\b/g,
  /**
   * A booking reference the pass NAMES. Tried first, and the only form that is
   * trusted on letters alone.
   */
  PNR_LABELLED:
    /(?:PNR|Booking\s*(?:Reference|Ref|Code)|Buchungs(?:code|referenz|nummer)|Reservation\s*Code|Record\s*Locator)\s*:?\s*([A-Z0-9]{6})\b/i,
  /**
   * An unlabelled six-character token, which must contain a digit to count.
   *
   * The bare `[A-Z0-9]{6}` this replaces matched any six-letter word on the
   * pass: a German Lufthansa pass reported the PNR as "KLASSE", the column
   * heading above the cabin. That is not a cosmetic error — `findExistingFlight`
   * treats the PNR as its STRONGEST match key and looks it up before flight
   * number and date, so an invented one can merge a scan into an unrelated
   * flight. Refusing an all-letter record locator costs an optional field;
   * accepting a heading costs the wrong flight.
   */
  PNR: /\b(?=[A-Z0-9]{6}\b)(?=[A-Z]*\d)([A-Z0-9]{6})\b/,
  /*
   * Resolution note, merge of main into dev/openapi-complete (2026-08-30).
   *
   * Both lines fixed the same class independently. main (Forgejo #17) required a
   * LABEL, because a marketing mail produced "LEIDER" and an American Airlines
   * greeting produced "NSCHEN" — the tail of "WUENSCHEN", the umlaut breaking the
   * word boundary. The OCR line (Forgejo #36) instead let an unlabelled code
   * through only when it carries a DIGIT, because a boarding pass prints the
   * cabin heading "KLASSE" where a reference would sit.
   *
   * Kept the digit rule, because it is the superset: "NSCHEN" and "ANGEBO" carry
   * no digit and are still refused, so main's cases hold, while a pass that
   * prints a bare "E9VLVKC" is still read. Both suites are run against this —
   * `pnrRequiresLabel.test.ts` from main and `fieldPatterns.test.ts` from here.
   *
   * The shared reason survives either way: `findExistingFlight` treats the PNR as
   * its STRONGEST match key and looks it up before flight number and date, so an
   * invented one merges a scan into an unrelated flight.
   */
  SEAT: /\b([0-9]{1,2}[A-F])\b/i,
  /**
   * `Boarding` is deliberately NOT a gate label: on almost every pass it
   * introduces the boarding TIME, not the gate, so "BOARDING 18:30" was being
   * read as gate "18". A pass that writes "Boarding Gate B12" still matches on
   * `Gate`. The trailing guard rejects a clock even where a gate label does
   * precede one, and the `\b` stops it from backing off to a shorter number to
   * escape that guard ("Gate 18:30" must yield nothing, never "1").
   */
  GATE: /(?:Gate|Ausgang|Steig)\s*:?\s*([A-Z]?\d{1,3}[A-Z]?)\b(?!\s*:)/i,
  TERMINAL: /Terminal\s*:?\s*([A-Z0-9]+)/i,
  DATE_ISO: /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/g,
  PRICE_EUR: /(\d{1,5}[.,]\d{2})\s?(EUR|€)/i,
  TICKET_NUMBER: /\b(\d{13})\b/,
};

/**
 * Parse text for common flight data patterns
 */
/**
 * The flight number, chosen from every candidate rather than the first one.
 *
 * A GATE has the same shape once OCR has been at it. Gates are printed as
 * "B08", "E06", "K18" — a letter and two digits — and the O/0 and I/1
 * confusions turn them into "BO8", "EO6", "KII8", which match a flight number
 * exactly. They also sit ABOVE the flight number on the card, so first-match
 * wins meant the gate won: three of the twelve passes in `test-samples/` were
 * reported as flight EO6, KII8 and BO8 instead of LH2415, LH2414 and LH2317.
 *
 * The letters settle it. `LH`, `EN` and `LX` are airlines; `EO`, `KI` and `BO`
 * are not. The check uses the curated cold-start list rather than the airline
 * DB on purpose — this parser has to work in a script, in a test, and before
 * the catalogue cache is warm.
 *
 * A candidate with an unknown prefix is still accepted when nothing better is
 * on the pass: the list is ~145 common carriers, not a world index, and a real
 * flight on an obscure airline must not be dropped for being unfashionable.
 */
export function pickFlightNumber(text: string): string | undefined {
  const candidates = Array.from(text.matchAll(PATTERNS.FLIGHT_NUMBER_ALL))
    .map((m) => validateFlightNumber(m[1]))
    .filter((f): f is string => f !== undefined);
  if (candidates.length === 0) {
    return undefined;
  }
  const known = candidates.find((f) => {
    const prefix = f.match(/^([A-Z]{2})/)?.[1];
    return prefix !== undefined && prefix in AIRLINE_IATA_MAP;
  });
  return known ?? candidates[0];
}

export function extractFlightDataFromText(text: string): Partial<ParsedBooking> {
  const result: Partial<ParsedBooking> = {};

  // Flight number
  const flightNumber = pickFlightNumber(text);
  if (flightNumber) {
    result.flightNumber = flightNumber;
    result.airline = extractAirlineCode(flightNumber);
  }

  // PNR/Booking reference — a labelled one first, since that is the only form
  // that can be trusted without a digit in it.
  const pnrMatch = text.match(PATTERNS.PNR_LABELLED) ?? text.match(PATTERNS.PNR);
  if (pnrMatch) {
    result.pnr = pnrMatch[1].toUpperCase();
    result.bookingReference = pnrMatch[1].toUpperCase();
  }

  // Seat
  const seatMatch = text.match(PATTERNS.SEAT);
  if (seatMatch) {
    result.seat = seatMatch[1].toUpperCase();
  }

  // Gate
  const gateMatch = text.match(PATTERNS.GATE);
  if (gateMatch) {
    result.gate = gateMatch[1].toUpperCase();
  }

  // Terminal
  const terminalMatch = text.match(PATTERNS.TERMINAL);
  if (terminalMatch) {
    result.terminal = terminalMatch[1];
  }

  // Price
  const priceMatch = text.match(PATTERNS.PRICE_EUR);
  if (priceMatch) {
    result.price = priceMatch[1];
    result.currency = 'EUR';
  }

  // Ticket number
  const ticketMatch = text.match(PATTERNS.TICKET_NUMBER);
  if (ticketMatch) {
    result.ticketNumber = ticketMatch[1];
  }

  return result;
}

/**
 * Clean JSON response from LLM (remove markdown, etc.)
 */
export function cleanLLMJsonResponse(response: string): string {
  let cleaned = response.trim();

  // Remove markdown code blocks
  if (cleaned.includes('```json')) {
    cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  } else if (cleaned.includes('```')) {
    cleaned = cleaned.replace(/```\n?/g, '');
  }

  // Remove any text before first [ or {
  const jsonStart = Math.min(
    cleaned.indexOf('[') >= 0 ? cleaned.indexOf('[') : Infinity,
    cleaned.indexOf('{') >= 0 ? cleaned.indexOf('{') : Infinity
  );
  if (jsonStart > 0 && jsonStart !== Infinity) {
    cleaned = cleaned.substring(jsonStart);
  }

  // Remove any text after last ] or }
  const jsonEnd = Math.max(
    cleaned.lastIndexOf(']'),
    cleaned.lastIndexOf('}')
  );
  if (jsonEnd > 0) {
    cleaned = cleaned.substring(0, jsonEnd + 1);
  }

  return cleaned;
}

/**
 * Standard prompt for vision models (boarding pass parsing)
 */
export function getVisionParserPrompt(): string {
  return `You are an expert boarding pass analyzer. Extract flight information from this boarding pass image with high accuracy.

CRITICAL FIELDS (must be extracted if visible):
- flightNumber: 2-3 letter airline code + 1-4 digits (e.g., LH103, FR8234, BA472, EN8752, EN8409, LX754, LX1101, LH2465, LH2460, LH2415, LH2414, LH2319, LH2318, LH2317)
  * Look for patterns like "LH 103", "LH103", "Flight LH103", or similar
  * Usually displayed prominently near the top or center of the boarding pass
  * May be in a large font or highlighted section
- departureCode: Departure airport IATA code (ALWAYS exactly 3 uppercase letters, e.g., MUC, FRA, LUX, HEL, ARN, ZRH)
  * Usually shown near the departure city name or in a route section (e.g., "LUX → MUC" or "MUC-MUC")
- arrivalCode: Arrival airport IATA code (ALWAYS exactly 3 uppercase letters, e.g., CDG, FCO, BER, MUC, FRA, LUX)
  * Usually shown near the arrival city name or in a route section
- departureTime: Departure date and time in ISO 8601 format (YYYY-MM-DDTHH:MM)
  * Extract the DATE from the boarding pass date field (often shown as "DD MMM YYYY" or "DAY MONTH YEAR")
  * Combine date with departure time to create full ISO 8601 timestamp (e.g., 2025-11-18T14:30)

IMPORTANT FIELDS (extract if visible - these are often present):
- seat: Seat number (e.g., "26F", "12A", "42C", "16F", "10A", "15C", "11C", "1C", "16C", "11A")
  * Look for labels like "Seat", "Sitz", "Sitzplatz", "Place", or similar
  * Format is usually 1-2 digits followed by a letter (A-F)
- gate: Gate number (e.g., "B45", "A12", "G32", "B08", "G28", "029", "E06", "K18", "G29", "G35")
  * Look for labels like "Gate", "Gate:", "Boarding Gate", "GATE", or similar
  * May be numeric only (e.g., "029") or alphanumeric (e.g., "B08", "G32")
- pnr: Booking reference/PNR (usually 6 alphanumeric characters, e.g., "9RFAA7", "85LMUN", "7RH6NS", "K6CH9R", "9C2R2U")
  * Look for labels like "Booking Reference", "PNR", "Confirmation", "Reservation Code", "Buchungsreferenz", or similar
  * Usually 6 characters, may be all letters, all numbers, or mixed
- boardingGroup: Boarding group/zone (e.g., "1", "2", "3", "A", "Zone 3", "Group 5")
  * Look for labels like "Group", "GRP", "Boarding Group", "Zone", or similar
  * May be just a number or letter

OPTIONAL FIELDS (extract if visible):
- airline: Full airline name (e.g., "Lufthansa", "Ryanair", "British Airways", "SWISS", "Eurowings")
- terminal: Terminal (e.g., "1", "2", "A", "B")
- bookingReference: Same as PNR (use same value)
- seatClass: Cabin class (e.g., "Economy", "Business", "First", "Premium Economy")
- aircraft: Aircraft type if visible (e.g., "A321", "Boeing 737", "A320")
- arrivalTime: Arrival time in ISO format. NOTE: Boarding passes RARELY show arrival time - only departure and boarding times are typically visible. If arrival time is NOT clearly shown on the boarding pass, return null. Do NOT guess or calculate - only extract if explicitly displayed.

FIELDS NOT ON BOARDING PASS (always null):
- price, currency, taxes, fees, ticketNumber (these are NOT shown on boarding passes)

EXTRACTION METHODOLOGY:
1. SCAN THE ENTIRE BOARDING PASS: Look systematically from top to bottom, left to right
2. IDENTIFY KEY SECTIONS: Find sections labeled with "Flight", "Gate", "Seat", "PNR", "Booking Reference", etc.
3. READ CAREFULLY: Pay attention to small text, labels, and formatting
4. EXTRACT EXACTLY: Copy the exact text you see - don't modify or guess
5. VALIDATE FORMAT: Ensure flight numbers match pattern (2-3 letters + 1-4 digits), IATA codes are 3 letters

ANTI-HALLUCINATION RULES (CRITICAL):
⚠️ The example values below are NEVER correct for your specific boarding pass image.
⚠️ ONLY extract information you can actually READ from the boarding pass in the image.
⚠️ NEVER use placeholder values like "ABC123", "XYZ789", "LH103", or "26F".
⚠️ If you cannot clearly read a field, return null - do NOT guess or use example values.
⚠️ Flight numbers are CRITICAL - look carefully in the center/top area of the boarding pass
⚠️ Seat, Gate, and PNR are usually in smaller text - scan carefully for these fields

EXAMPLE OUTPUT FORMAT (use different values from your actual boarding pass):
{
  "airline": "British Airways",
  "flightNumber": "BA456",
  "departureCode": "LHR",
  "arrivalCode": "CDG",
  "departureTime": "2025-12-15T09:45",
  "arrivalTime": null,
  "seat": "12A",
  "gate": "B22",
  "terminal": "5",
  "pnr": "XYZ789",
  "bookingReference": "XYZ789",
  "boardingGroup": "2",
  "seatClass": "Economy",
  "aircraft": "A319",
  "price": null,
  "currency": null,
  "taxes": null,
  "fees": null,
  "ticketNumber": null
}

Return ONLY valid JSON (no markdown, no code blocks, no explanations). Use null for fields that are not visible or readable on the boarding pass.`;
}

/**
 * Standard prompt for text models (email parsing)
 */
export function getTextParserPrompt(subject: string, text: string): string {
  const cleanText = text
    .replace(/\0/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 15000);

  return `You are an expert flight booking email parser with deep knowledge of airline booking formats worldwide.

TASK: Extract ALL flights from the email below. Each flight is a separate leg of the journey (outbound, return, connections).

CRITICAL RULES:
1. IATA codes are ALWAYS 3 uppercase letters (e.g., MUC, FRA, LUX, CDG, FCO)
2. Flight numbers: 2-3 letter airline code + 1-4 digits (e.g., LH103, FR8234, BA472)
3. Dates in ISO 8601 format: YYYY-MM-DDTHH:MM (e.g., 2025-11-18T11:00)
4. If a field is genuinely not found in the email, use null (not empty string)
5. Extract EACH flight leg as a separate object (round-trip = 2 objects, multi-leg = multiple objects)

IMPORTANT - CHECK EMAIL SUBJECT FOR ROUTE INFORMATION:
The email subject often contains critical route information when IATA codes are not in the body.
Examples of common patterns to extract:
- "München nach Luxemburg am 18 November 2025" → departureCode: MUC, arrivalCode: LUX, date: 2025-11-18
- "Frankfurt nach Rom" → departureCode: FRA, arrivalCode: FCO
- "von Paris nach Berlin" → departureCode: CDG (or ORY), arrivalCode: BER (or TXL/SXF)

Common city-to-IATA conversions:
München/Munich → MUC, Frankfurt → FRA, Berlin → BER, Hamburg → HAM, Köln/Cologne → CGN
Paris → CDG (or ORY), London → LHR (or LGW/STN), Rom/Rome → FCO, Barcelona → BCN
New York → JFK (or EWR/LGA), Los Angeles → LAX, Tokyo → NRT (or HND)

CRITICAL FIELDS (must be extracted from booking emails):
- flightNumber: Extract from "Flight LH 103" or "LH103" → return as "LH103" (no spaces)
- departureCode: 3-letter IATA code (check subject if not in body!)
- arrivalCode: 3-letter IATA code (check subject if not in body!)
- departureTime: ISO 8601 format. Extract from "Departure: 18.11.2025 14:30" → "2025-11-18T14:30"
- arrivalTime: EXPECTED in booking emails! Most confirmation emails contain BOTH departure AND arrival times in the itinerary section. Extract from "Arrival: 18 Nov 2025, 16:15" or similar. If genuinely not visible, use null.

IMPORTANT FIELDS (extract if present in email):
- airline: Full airline name (e.g., "Lufthansa", "Ryanair")
- pnr: Booking code/PNR (usually 6 alphanumeric characters, e.g., "7RH6NS", "K6CH9R"). Usually SAME for all flights in one booking.
- bookingReference: Same as PNR (use same value)
- seat: Seat assignment if pre-selected (e.g., "16F", "24A"). May differ per flight leg.

OPTIONAL FIELDS (extract if available):
- terminal: Departure terminal (e.g., "1", "2", "B")
- gate: Boarding gate (often not in confirmation emails)
- price: Total price (e.g., "189.50")
- currency: Currency code (e.g., "EUR", "USD")
- taxes: Tax amount if itemized
- fees: Fees amount if itemized
- aircraft: Aircraft type (e.g., "A320", "Boeing 737")
- seatClass: Cabin class (e.g., "Economy", "Business")
- ticketNumber: E-ticket number (usually 13 digits)
- boardingGroup: Boarding group (often not in confirmation emails)

MULTI-FLIGHT HANDLING:
If the email contains ROUND-TRIP or MULTI-LEG flights:
- Extract EACH flight leg separately
- Outbound flight first, then return flight
- Each leg must have its own departureTime and arrivalTime
- Example: Frankfurt → Tokyo (outbound), Tokyo → Frankfurt (return) = 2 separate objects in the array

AIRLINE-SPECIFIC FORMATS (Common patterns):

Lufthansa emails:
- Flight: "LH 103" or "LH103" → extract as "LH103"
- Route: "MUC-FRA" or "MUC → FRA"
- Time: "18.11.2025 14:30" → convert to "2025-11-18T14:30"
- PNR/Booking Code: 6 alphanumeric characters (e.g., "ABC123")

Ryanair emails:
- Flight: "FR 8234"
- Route often in subject line
- Times in 24h format

British Airways emails:
- Flight: "BA 472"
- Reference: "Booking reference" field
- Times with timezone info (convert to local departure time)

EXAMPLE OUTPUT (VALID JSON ARRAY):
[
  {
    "airline": "Lufthansa",
    "flightNumber": "LH2317",
    "departureCode": "LUX",
    "arrivalCode": "MUC",
    "departureTime": "2025-11-18T09:00",
    "arrivalTime": "2025-11-18T10:15",
    "pnr": "XYZ789",
    "bookingReference": "XYZ789",
    "seat": "16F",
    "terminal": "2",
    "gate": null,
    "price": "189.50",
    "currency": "EUR",
    "taxes": "42.30",
    "fees": "15.20",
    "aircraft": "A320",
    "seatClass": "Economy",
    "ticketNumber": null,
    "boardingGroup": null
  }
]

For round-trip, return TWO objects (one for outbound, one for return).

OUTPUT FORMAT: Return ONLY a valid JSON array. No explanations, no markdown code blocks, no additional text - just the JSON array starting with [ and ending with ].

EMAIL SUBJECT: ${subject}

EMAIL BODY: ${cleanText}

JSON ARRAY OUTPUT:`;
}

/**
 * Strip HTML-tag fragments and bare URLs from plain-text email bodies, then
 * normalise whitespace — mirrors the frontend `filterEmailText` shown in the
 * annotation view.  Email addresses are intentionally preserved so that the
 * From: header can still be used for template/airline detection.
 */
export function cleanEmailBody(text: string): string {
  let out = text;
  // Remove angle-bracket fragments: <https://...>, <img.png>, etc.
  // Loop until convergence so that adversarial inputs like
  // `<<script>foo<</script>>` cannot smuggle a tag through a single pass.
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  // Remove bare http/https and www URLs
  out = out.replace(/https?:\/\/[^\s<>]+/gi, "");
  out = out.replace(/www\.[^\s<>]+/gi, "");
  // Trim leading/trailing whitespace on every line (removes stray tab/space prefix from tab-delimited blocks)
  out = out.split("\n").map((l) => l.trim()).join("\n");
  // Collapse runs of 2+ consecutive blank lines to one
  out = out.replace(/\n{2,}/g, "\n");
  // Collapse multiple spaces/tabs within a line to a single space
  out = out.replace(/[ \t]{2,}/g, " ");
  return out.trim();
}

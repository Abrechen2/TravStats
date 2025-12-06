import { ParsedBooking } from '../../bookingParser';

/**
 * Validate IATA airport code (must be exactly 3 uppercase letters)
 */
export function validateIATACode(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const cleaned = code.toUpperCase().trim();
  return /^[A-Z]{3}$/.test(cleaned) ? cleaned : undefined;
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
export function normalizeParsedBooking(data: any): ParsedBooking {
  const missing = getMissingFields(data);

  return {
    airline: data.airline || data.flightNumber?.slice(0, 2).toUpperCase() || undefined,
    flightNumber: validateFlightNumber(data.flightNumber),
    departureCode: validateIATACode(data.departureCode),
    arrivalCode: validateIATACode(data.arrivalCode),
    departureTime: validateDateTime(data.departureTime),
    arrivalTime: validateDateTime(data.arrivalTime),
    pnr: data.pnr?.toUpperCase() || data.bookingReference?.toUpperCase() || undefined,
    seat: data.seat?.toUpperCase() || undefined,
    terminal: data.terminal || undefined,
    gate: data.gate?.toUpperCase() || undefined,
    price: data.price ? String(data.price) : undefined,
    currency: data.currency?.toUpperCase() || undefined,
    aircraft: data.aircraft || undefined,
    seatClass: data.seatClass || undefined,
    bookingReference: data.bookingReference?.toUpperCase() || data.pnr?.toUpperCase() || undefined,
    ticketNumber: data.ticketNumber || undefined,
    boardingGroup: data.boardingGroup || undefined,
    taxes: data.taxes ? String(data.taxes) : undefined,
    fees: data.fees ? String(data.fees) : undefined,
    missing,
  };
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
  IATA_CODE: /\b([A-Z]{3})\b/g,
  PNR: /\b([A-Z0-9]{6})\b/,
  SEAT: /\b([0-9]{1,2}[A-F])\b/i,
  GATE: /(?:Gate|Boarding)\s*:?\s*([A-Z]?\d{1,3}[A-Z]?)/i,
  TERMINAL: /Terminal\s*:?\s*([A-Z0-9]+)/i,
  DATE_ISO: /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/,
  PRICE_EUR: /(\d{1,5}[.,]\d{2})\s?(EUR|€)/i,
  TICKET_NUMBER: /\b(\d{13})\b/,
};

/**
 * Parse text for common flight data patterns
 */
export function extractFlightDataFromText(text: string): Partial<ParsedBooking> {
  const result: Partial<ParsedBooking> = {};

  // Flight number
  const flightMatch = text.match(PATTERNS.FLIGHT_NUMBER);
  if (flightMatch) {
    result.flightNumber = validateFlightNumber(flightMatch[1]);
    result.airline = extractAirlineCode(flightMatch[1]);
  }

  // PNR/Booking reference
  const pnrMatch = text.match(PATTERNS.PNR);
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
  return `You are an expert boarding pass analyzer. Extract flight information from this boarding pass image.

CRITICAL RULES:
1. IATA airport codes are ALWAYS exactly 3 uppercase letters (e.g., MUC, FRA, LUX, BER)
2. Flight numbers format: 2-letter airline code + 1-4 digits (e.g., LH103, FR8234, BA472)
3. Dates in ISO 8601 format: YYYY-MM-DDTHH:MM (e.g., 2025-12-05T14:30)
4. Extract the date from the boarding pass (often shown as DAY MONTH YEAR or DD MMM)
5. If a field is not visible or readable, use null

FIELDS TO EXTRACT:
- airline: Full airline name (e.g., "Lufthansa", "Ryanair")
- flightNumber: e.g., "LH103"
- departureCode: Departure airport IATA code (3 letters)
- arrivalCode: Arrival airport IATA code (3 letters)
- departureTime: Departure date and time in ISO format
- arrivalTime: Arrival date and time in ISO format (if available)
- seat: Seat number (e.g., "26F", "12A")
- gate: Gate number (e.g., "B45", "A12")
- terminal: Terminal (e.g., "1", "2", "A")
- pnr: Booking reference/PNR (usually 6 alphanumeric characters)
- boardingGroup: Boarding group/zone (e.g., "1", "A", "Zone 3")
- seatClass: e.g., "Economy", "Business", "First"
- aircraft: Aircraft type if visible (e.g., "A321", "Boeing 737")

Return ONLY valid JSON (no markdown formatting) in this exact structure:
{
  "airline": "string or null",
  "flightNumber": "string or null",
  "departureCode": "string or null",
  "arrivalCode": "string or null",
  "departureTime": "string or null",
  "arrivalTime": "string or null",
  "seat": "string or null",
  "gate": "string or null",
  "terminal": "string or null",
  "pnr": "string or null",
  "bookingReference": "string or null",
  "boardingGroup": "string or null",
  "seatClass": "string or null",
  "aircraft": "string or null",
  "price": null,
  "currency": null,
  "taxes": null,
  "fees": null,
  "ticketNumber": null
}`;
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
    .substring(0, 6000);

  return `You are an expert flight booking email parser with deep knowledge of airline booking formats.

TASK: Extract ALL flights from the email below. Each flight is a separate leg of the journey.

CRITICAL RULES:
1. Extract EACH flight separately (outbound, return, connections)
2. IATA codes are ALWAYS 3 uppercase letters (e.g., MUC, FRA, LUX)
3. Flight numbers format: 2-letter airline code + 1-4 digits (e.g., LH103, FR8234)
4. Dates in ISO 8601 format: YYYY-MM-DDTHH:MM (e.g., 2025-11-18T11:00)
5. If a field is not found, use null (not empty string)

OUTPUT FORMAT: Return ONLY a valid JSON array. No explanations, no markdown, just the JSON array.

EXTRACT THESE FIELDS FOR EACH FLIGHT:
- flightNumber, departureCode, arrivalCode, departureTime, arrivalTime
- pnr, seat, terminal, gate, price, currency
- aircraft, seatClass, bookingReference, ticketNumber, boardingGroup, taxes, fees

EMAIL SUBJECT: ${subject}

EMAIL BODY: ${cleanText}

JSON OUTPUT:`;
}

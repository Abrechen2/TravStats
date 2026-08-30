import { getParserConfig, parseEmail } from './parsers/factory';
import logger from '../utils/logger';

export interface ParsedBooking {
  airline?: string;
  operatingAirline?: string;
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
  // Phase 1: New fields
  baggageAllowance?: string;      // e.g. "1x23kg", "20kg included"
  frequentFlyerNumber?: string;   // e.g. "LH-123456789"
  bookingClassLetter?: string;    // IATA booking class, e.g. "Y", "M", "C", "J", "F"
  coPassengers?: string[];        // e.g. ["Max Mustermann", "Erika Musterfrau"]
  parserTemplate?: string;        // Which template was used, e.g. "LH"
  parserConfidence?: number;      // 0–100
  airlineNotice?: string;         // Transient: not persisted to DB, UI-only notice when no template found
  // Field names that the parser inferred (assigned a value the source did not state explicitly).
  // Used by the import-review UI to flag those fields with a "please verify" badge. Not persisted.
  inferredFields?: string[];
  missing: string[];
  fieldSources?: Partial<Record<
    "flightNumber" | "departureCode" | "arrivalCode" |
    "departureTime" | "arrivalTime" | "pnr" | "aircraft" | "seat" | "terminal" | "gate",
    "template" | "llm" | "empty"
  >>;
}

export interface ParseResult {
  flights: ParsedBooking[];
  parserUsed: 'regex' | 'ollama';
  ollamaAvailable: boolean;
  fallbackUsed?: boolean;
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
    userId?: string;
    /**
     * When the email was sent. A confirmation that writes a day and month but
     * no year is read against this instead of against today (#285).
     */
    referenceDate?: Date;
  }
): Promise<ParseResult> {
  logger.debug({
    operation: 'booking_parser_start',
    message: 'Starting email parsing with factory system',
  });

  // Get parser config (regex/template only)
  const config = await getParserConfig(undefined, undefined, userSettings?.userId);

  // Parse email using factory
  const result = await parseEmail(
    subject || '',
    text || '',
    html,
    { ...config, referenceDate: userSettings?.referenceDate }
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
  const ollamaAvailable = config.textFallbacks.includes('ollama');

  return {
    flights: result.flights,
    parserUsed: result.provider as 'regex' | 'ollama',
    ollamaAvailable,
    fallbackUsed: result.fallbackUsed,
  };
}

/**
 * Parse plain text (e.g., extracted from a PDF) as if it were an email body.
 */
export async function parseBookingText(text: string, userId?: string): Promise<ParseResult> {
  return parseBookingEmail(undefined, text, undefined, userId ? { userId } : undefined);
}

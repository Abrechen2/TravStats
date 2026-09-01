import { createWorker, Worker } from 'tesseract.js';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import {
  normalizeParsedBooking,
  extractFlightDataFromText,
  validateIATACode,
  PATTERNS,
} from '../shared/utils';
import { CITY_TO_IATA } from '../text/regexMappings';
import { normalizeCityName } from '../text/regexAirportExtractor';
import logger from '../../../utils/logger';

/**
 * Three-letter tokens that are printed ON boarding passes but are not
 * airports: column headings, status words, honorifics.
 *
 * Only consulted by the last-resort branch of {@link
 * TesseractVisionParser.extractIATACodes}; anything on the IATA whitelist wins
 * before this list is reached. Kept to tokens that are unambiguously labels —
 * a code that is BOTH a label somewhere and a real airport (THE = Teresina)
 * stays out of the route by the whitelist ordering, not by being banned here.
 */
const NOT_AIRPORT_CODES = new Set([
  // Pre-existing entries: ordinary English words that survive OCR.
  'THE', 'AND', 'FOR', 'NOT', 'ARE', 'YOU',
  // Column headings and field labels, German and English.
  'GRP', 'SEQ', 'PNR', 'SEC', 'REF', 'FLT', 'TKT', 'ETK', 'ZON', 'ROW',
  'DEP', 'ARR', 'GRO', 'CLS', 'STS', 'NBR',
  // Frequent-flyer and status printing (Lufthansa: "FTL LH*S").
  'FTL', 'FTV', 'SEN', 'HON',
  // Honorifics in the passenger row.
  'MRS', 'MSS',
  // Clock/zone words.
  'GMT', 'UTC',
]);

/**
 * A day and a month with no clock after them, the airline way: `30AUG26`,
 * `30AUG2026`, `30 AUG 26`, `05 DEC`.
 *
 * Separators are optional throughout, because the printed form runs the three
 * parts together. The year is optional too, and a two-digit one that turns out
 * to be an hour is refused rather than read as a year — without the lookahead,
 * "30 AUG 18:30" would date the flight to 2018.
 */
const DATE_WITHOUT_TIME =
  /\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{4}|\d{2}(?!\s*:))?/i;

/** "26" → 2026, "2026" → 2026, nothing → this year (flagged as inferred). */
function expandYear(captured: string | undefined): string {
  if (!captured) return new Date().getFullYear().toString();
  return captured.length === 2 ? `20${captured}` : captured;
}

/**
 * Sauvola, not Otsu.
 *
 * Tesseract binarises before it reads, and its default (Otsu, `0`) picks ONE
 * global threshold for the whole image. A boarding pass defeats that twice
 * over: the card is coloured — navy on saturated orange has far less luminance
 * contrast than it appears to have — and a phone screenshot sets it in a black
 * letterbox, which drags the global threshold away from the card entirely. The
 * result is not a bad read, it is no read: a real Lufthansa Wallet pass
 * returned the status-bar clock, the word "Lufthansa" and the security number,
 * and nothing else.
 *
 * Sauvola (`2`) thresholds per neighbourhood, so the card is judged against the
 * card rather than against the margin around it.
 *
 * Measured 2026-08-30 over the twelve real passes in `test-samples/`, scoring
 * flight number, both airport codes and seat against `samples.json`:
 *
 * | | correct | wrong | missing | produced a date |
 * |---|---|---|---|---|
 * | Otsu | 10 | 4 | 34 | 1/12 |
 * | Sauvola | 35 | 3 | 10 | 8/12 |
 *
 * Better on every axis, including *fewer* wrong values — so this is not a
 * recall-for-precision trade. It also costs nothing: one parameter, no
 * preprocessing step and no new dependency.
 */
const THRESHOLDING_SAUVOLA = '2';

/**
 * Does this line look like the OCR reading a barcode rather than words?
 *
 * A field line on a boarding pass is made of words: "MUNCHEN FRANKFURT",
 * "LH117 30AUG26 18:30". The 2D barcode has no words in it, so what comes back
 * from that part of the card is a scatter of one- and two-character fragments —
 * "ol i kan 24", "r ple Tr", "4 rT: Hh". Judging a line by how much of it is
 * such fragments separates the two reliably, and does not depend on knowing
 * which airline printed the pass.
 *
 * Deliberately generous: a line is only rubble when MOST of it is fragments, so
 * a short genuine line ("MUC = FRA", two real tokens and a stray glyph) stays.
 */
function looksLikeRubble(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length < 3) {
    return false;
  }
  const fragments = tokens.filter((t) => t.replace(/[^A-Za-z0-9]/g, '').length <= 2);
  return fragments.length * 2 > tokens.length;
}

/** The pass with the OCR's rubble lines dropped. */
function readableLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !looksLikeRubble(line))
    .join('\n');
}

/**
 * The route read from the city names a pass prints above its codes.
 *
 * Null unless BOTH ends are found and they differ — a single city says nothing
 * about direction, and a city matched twice is a misread rather than a round
 * trip. Order is reading order, which is the order a pass prints departure and
 * destination in.
 */
function citiesToCodes(
  text: string,
): { departure: string; arrival: string } | null {
  const found: string[] = [];
  for (const word of text.split(/[^A-Za-zÀ-ÿ]+/)) {
    if (word.length < 3) continue;
    const code = CITY_TO_IATA[normalizeCityName(word)];
    if (code !== undefined && !found.includes(code)) {
      found.push(code);
    }
    if (found.length === 2) {
      return { departure: found[0], arrival: found[1] };
    }
  }
  return null;
}

/**
 * Tesseract OCR Vision Parser
 *
 * Provides free, local OCR-based boarding pass parsing without requiring external APIs.
 */
export class TesseractVisionParser implements IVisionParser {
  readonly provider: VisionProvider = 'tesseract';
  private worker: Worker | null = null;
  private isInitialized = false;

  /**
   * Initialize Tesseract worker (lazy loading)
   */
  private async ensureWorker(): Promise<Worker> {
    if (this.worker && this.isInitialized) {
      return this.worker;
    }

    logger.info('[Tesseract Parser] Initializing OCR worker...');

    this.worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          logger.debug(`[Tesseract Parser] OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    // Set on the worker, not per call: the worker is cached and reused, and
    // this must hold for every recognition it performs.
    await this.worker.setParameters({
      thresholding_method: THRESHOLDING_SAUVOLA,
    });

    this.isInitialized = true;
    logger.info('[Tesseract Parser] OCR worker initialized');

    return this.worker;
  }

  /**
   * A SECOND worker, for reading whole travel documents rather than boarding
   * passes — Forgejo #58.
   *
   * Deliberately separate from the one above, which stays exactly as it was.
   * The difference is the language set: a boarding pass is alphanumeric and
   * English, while the documents this one reads are hotel bills and sailing
   * confirmations, and the corpus this product is built against is German.
   * Reading "Nächte" with English-only training data loses the umlaut, and the
   * lodging parser matches on that word.
   *
   * Why not simply widen the existing worker: the extra language pack is
   * fetched at first use, and an air-gapped instance would then fail to create
   * ANY worker — taking boarding-pass scanning down with it, a feature that
   * works today. Two workers cost memory only once both are actually used, and
   * this one degrades to English on its own rather than failing.
   */
  private docWorker: Worker | null = null;

  private async ensureDocumentWorker(): Promise<Worker> {
    if (this.docWorker) return this.docWorker;

    try {
      this.docWorker = await createWorker(['eng', 'deu'], 1);
      logger.info('[Tesseract Parser] Document OCR worker initialized (eng+deu)');
    } catch (error) {
      // The German pack could not be fetched — offline, or no cache. English
      // still reads Latin script, so a degraded answer beats no answer; it is
      // logged at warn so the cause is visible when a German document parses
      // badly, rather than looking like a parser bug.
      logger.warn(
        { error },
        '[Tesseract Parser] German language pack unavailable, falling back to English only'
      );
      this.docWorker = await createWorker('eng', 1);
    }

    return this.docWorker;
  }

  /**
   * OCR an image and return the TEXT, without interpreting it as a flight.
   *
   * `parseImage` below answers "which flight is this", which is the wrong
   * question for a hotel invoice. This answers "what does it say", and the
   * caller hands the text to whichever domain parser applies — which is what
   * lets one image route serve all three domains.
   */
  async recognizeText(imageBase64: string): Promise<{ text: string; confidence: number }> {
    const worker = await this.ensureDocumentWorker();
    const { data } = await worker.recognize(Buffer.from(imageBase64, 'base64'));

    logger.info(
      { confidence: data.confidence, textLength: data.text.length },
      '[Tesseract Parser] Document OCR complete'
    );

    return { text: data.text, confidence: data.confidence };
  }

  /**
   * Cleanup worker on shutdown
   */
  async cleanup(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      logger.info('[Tesseract Parser] OCR worker terminated');
    }
    if (this.docWorker) {
      await this.docWorker.terminate();
      this.docWorker = null;
      logger.info('[Tesseract Parser] Document OCR worker terminated');
    }
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    // Tesseract.js is always available (bundled)
    return {
      available: true,
      metadata: {
        provider: 'tesseract',
        version: '4.x',
        language: 'eng',
        cost: 'free',
      },
    };
  }

  async parseImage(imageBase64: string): Promise<ParsedBooking> {
    logger.info('[Tesseract Parser] Starting OCR boarding pass parsing');

    try {
      const worker = await this.ensureWorker();

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(imageBase64, 'base64');

      // Perform OCR
      const { data } = await worker.recognize(imageBuffer);
      const extractedText = data.text;

      logger.info(
        {
          confidence: data.confidence,
          textLength: extractedText.length,
        },
        '[Tesseract Parser] OCR extraction complete'
      );
      logger.debug({ extractedText }, '[Tesseract Parser] Extracted text');

      // Extract flight data using pattern matching
      const parsedData = this.parseOCRText(extractedText);

      // Normalize and validate. `normalizeParsedBooking` only retains the fields
      // it explicitly enumerates, so any `inferredFields` set during parsing
      // (e.g. year fallback) must be merged back onto the normalized result.
      const result = normalizeParsedBooking(parsedData);
      if (parsedData.inferredFields && parsedData.inferredFields.length > 0) {
        const existing = result.inferredFields ?? [];
        result.inferredFields = Array.from(new Set([...existing, ...parsedData.inferredFields]));
      }

      logger.info(
        {
          flightNumber: result.flightNumber,
          route: `${result.departureCode} -> ${result.arrivalCode}`,
          missingFields: result.missing.length,
        },
        '[Tesseract Parser] Parsing complete'
      );

      return result;
    } catch (error) {
      logger.error({ error }, '[Tesseract Parser] OCR parsing failed');
      throw new Error(`Tesseract OCR parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse OCR text using pattern matching and heuristics
   */
  private parseOCRText(text: string): Partial<ParsedBooking> {
    const textUpper = text.toUpperCase();
    const result: Partial<ParsedBooking> = {};

    // Use common pattern extraction
    const basicData = extractFlightDataFromText(textUpper);
    Object.assign(result, basicData);

    // Enhanced IATA code extraction with context
    const iataCodes = this.extractIATACodes(textUpper);
    if (iataCodes.departure) result.departureCode = iataCodes.departure;
    if (iataCodes.arrival) result.arrivalCode = iataCodes.arrival;

    // Enhanced date/time extraction
    const times = this.extractDateTimes(text);
    if (times.departure) result.departureTime = times.departure;
    if (times.arrival) result.arrivalTime = times.arrival;
    // Propagate fields that the parser had to guess (e.g. year fallback) so the
    // import-review UI can flag them with a "please verify" badge.
    if (times.inferredFields.length > 0) {
      const existing = result.inferredFields ?? [];
      result.inferredFields = Array.from(new Set([...existing, ...times.inferredFields]));
    }

    // Airline name (common carriers)
    const airline = this.extractAirline(textUpper);
    if (airline) result.airline = airline;

    // Seat class
    const seatClass = this.extractSeatClass(textUpper);
    if (seatClass) result.seatClass = seatClass;

    // Aircraft type
    const aircraft = this.extractAircraft(text);
    if (aircraft) result.aircraft = aircraft;

    return result;
  }

  /**
   * Extract IATA codes with context awareness.
   *
   * `protected` for the same reason `extractDateTimes` is: the interesting
   * behaviour is which of a pass's many three-letter tokens it picks, and that
   * is worth testing without spinning up a real OCR run.
   */
  protected extractIATACodes(text: string): { departure?: string; arrival?: string } {
    const result: { departure?: string; arrival?: string } = {};

    // Look for "FROM XXX TO YYY" pattern
    const routePattern = /(?:FROM|DEP|DEPARTURE)\s+([A-Z]{3})\s+(?:TO|ARR|ARRIVAL)\s+([A-Z]{3})/i;
    const routeMatch = text.match(routePattern);
    if (routeMatch) {
      result.departure = routeMatch[1];
      result.arrival = routeMatch[2];
      return result;
    }

    // Look for "XXX -> YYY" or "XXX - YYY" pattern
    const arrowPattern = /\b([A-Z]{3})\s*(?:->|-|TO)\s*([A-Z]{3})\b/;
    const arrowMatch = text.match(arrowPattern);
    if (arrowMatch) {
      result.departure = arrowMatch[1];
      result.arrival = arrowMatch[2];
      return result;
    }

    // The city names printed above the codes, e.g. "MÜNCHEN … FRANKFURT".
    //
    // Stronger evidence than any leftover three-letter token, and it has to be
    // tried before them: Sauvola thresholding reads far more of the barcode
    // field than Otsu did, and that field turns into lines like "ol i kan 24"
    // and "r ple Tr". On the pass that prompted this, the harvest below then
    // produced the route KAN → PLE — a confident, entirely invented flight,
    // from a pass whose own header says MÜNCHEN and FRANKFURT.
    const cities = citiesToCodes(text);
    if (cities !== null) {
      return cities;
    }

    // Fallback: every 3-letter token on the pass, in reading order — with the
    // OCR's own rubble left out, see `looksLikeRubble`.
    const allCodes: string[] = [];
    const matches = readableLines(text).matchAll(PATTERNS.IATA_CODE);
    for (const match of matches) {
      const code = match[1];
      // Filter out common false positives
      if (!NOT_AIRPORT_CODES.has(code)) {
        allCodes.push(code);
      }
    }

    const uniqueCodes = [...new Set(allCodes)];

    // Codes we can actually vouch for come first. A boarding pass is full of
    // three-letter LABELS — "GRP", "SEQ", "PNR", "SEC" — and they are printed
    // in the header, ABOVE the route. Taking the first two tokens therefore
    // read a Lufthansa pass as GRP → MUC: the group column, then the departure
    // airport, with the actual destination dropped. Preferring known airports
    // costs nothing when the pass is plain and is the whole difference here.
    const known = uniqueCodes.filter((code) => validateIATACode(code, true));
    const candidates = known.length >= 2 ? known : uniqueCodes;
    if (candidates.length >= 2) {
      result.departure = candidates[0];
      result.arrival = candidates[1];
    }

    return result;
  }

  /**
   * Extract departure and arrival times.
   *
   * `inferredFields` lists fields whose value the parser had to guess (rather
   * than read directly from the source). The boarding-pass-format fallback,
   * for example, will silently substitute the current year when the OCR text
   * doesn't carry one — that case is flagged here so the UI can warn the user.
   *
   * Marked `protected` to enable focused unit testing via subclassing without
   * exposing it on the public parser surface.
   */
  protected extractDateTimes(text: string): {
    departure?: string;
    arrival?: string;
    inferredFields: string[];
  } {
    const result: { departure?: string; arrival?: string; inferredFields: string[] } = {
      inferredFields: [],
    };

    // Look for ISO format dates
    const isoMatches = text.matchAll(PATTERNS.DATE_ISO);
    const dates = Array.from(isoMatches).map((m) => m[1]);

    if (dates.length >= 1) result.departure = dates[0];
    if (dates.length >= 2) result.arrival = dates[1];

    // Try to extract from common boarding pass formats
    // Example: "05 DEC 2025 14:30" or "DEC 5 14:30"
    const datePattern = /(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})?\s*(\d{1,2}):(\d{2})/gi;
    const dateMatches = Array.from(text.matchAll(datePattern));

    if (dateMatches.length > 0 && !result.departure) {
      const match = dateMatches[0];
      // The regex's year group is optional — when absent we silently fall back
      // to the current year, so flag the field as inferred for the review UI.
      const yearCaptured = match[3];
      const year = yearCaptured || new Date().getFullYear().toString();
      const month = this.monthToNumber(match[2]);
      const day = match[1].padStart(2, '0');
      const hour = match[4].padStart(2, '0');
      const minute = match[5];
      result.departure = `${year}-${month}-${day}T${hour}:${minute}`;
      if (!yearCaptured) {
        result.inferredFields.push('departureTime');
      }
    }

    // Last: the airline date with no departure time next to it.
    //
    // The pattern above needs a clock immediately after the date, and the
    // commonest boarding-pass date of all does not have one: Lufthansa prints
    // "DATUM 30AUG26" and puts 18:30 under BOARDING, one column away. So a
    // real pass produced NO date, `departureTime` stayed empty, and every
    // caller that requires a date — the Companion's photo capture among them —
    // threw the whole parse away.
    //
    // The time is left at midnight rather than borrowed from elsewhere on the
    // pass, deliberately: the clocks printed near a date are boarding and gate
    // closing, not departure, and `T00:00` is the placeholder this codebase
    // already reads as date-only (`regexDateExtractor` patches real times over
    // it, and the Companion's `localClockTime` drops it).
    if (!result.departure) {
      const dateOnly = text.match(DATE_WITHOUT_TIME);
      if (dateOnly) {
        const yearCaptured = dateOnly[3];
        const year = expandYear(yearCaptured);
        const month = this.monthToNumber(dateOnly[2]);
        const day = dateOnly[1].padStart(2, '0');
        result.departure = `${year}-${month}-${day}T00:00`;
        if (!yearCaptured) {
          result.inferredFields.push('departureTime');
        }
      }
    }

    return result;
  }

  /**
   * Extract airline name from common carriers
   */
  private extractAirline(text: string): string | undefined {
    const airlines = [
      { pattern: /LUFTHANSA/i, name: 'Lufthansa' },
      { pattern: /RYANAIR/i, name: 'Ryanair' },
      { pattern: /EASYJET/i, name: 'easyJet' },
      { pattern: /EUROWINGS/i, name: 'Eurowings' },
      { pattern: /BRITISH AIRWAYS/i, name: 'British Airways' },
      { pattern: /AIR FRANCE/i, name: 'Air France' },
      { pattern: /KLM/i, name: 'KLM' },
      { pattern: /SWISS/i, name: 'Swiss' },
      { pattern: /AUSTRIAN/i, name: 'Austrian Airlines' },
    ];

    for (const { pattern, name } of airlines) {
      if (pattern.test(text)) {
        return name;
      }
    }

    return undefined;
  }

  /**
   * Extract seat class
   */
  private extractSeatClass(text: string): string | undefined {
    if (/BUSINESS\s*CLASS/i.test(text)) return 'Business';
    if (/FIRST\s*CLASS/i.test(text)) return 'First';
    if (/PREMIUM\s*ECONOMY/i.test(text)) return 'Premium Economy';
    if (/ECONOMY\s*LIGHT/i.test(text)) return 'Economy Light';
    if (/ECONOMY/i.test(text)) return 'Economy';
    return undefined;
  }

  /**
   * Extract aircraft type
   */
  private extractAircraft(text: string): string | undefined {
    // Look for common aircraft patterns
    const aircraftPattern = /(AIRBUS|BOEING|EMBRAER)?\s*(A\d{3}|B\d{3,4}|E\d{3})/i;
    const match = text.match(aircraftPattern);
    if (match) {
      return match[0].trim();
    }
    return undefined;
  }

  /**
   * Convert month name to number string
   */
  private monthToNumber(month: string): string {
    const months: Record<string, string> = {
      JAN: '01',
      FEB: '02',
      MAR: '03',
      APR: '04',
      MAY: '05',
      JUN: '06',
      JUL: '07',
      AUG: '08',
      SEP: '09',
      OCT: '10',
      NOV: '11',
      DEC: '12',
    };
    return months[month.toUpperCase()] || '01';
  }
}

// Singleton instance
let instance: TesseractVisionParser | null = null;

export function getTesseractParser(): TesseractVisionParser {
  if (!instance) {
    instance = new TesseractVisionParser();
  }
  return instance;
}

// Cleanup on process exit
process.on('beforeExit', async () => {
  if (instance) {
    await instance.cleanup();
  }
});

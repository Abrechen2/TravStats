import { createWorker, Worker } from 'tesseract.js';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, extractFlightDataFromText, PATTERNS } from '../shared/utils';
import logger from '../../../utils/logger';

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
   * Extract IATA codes with context awareness
   */
  private extractIATACodes(text: string): { departure?: string; arrival?: string } {
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

    // Fallback: extract all IATA codes and take first two
    const allCodes: string[] = [];
    const matches = text.matchAll(PATTERNS.IATA_CODE);
    for (const match of matches) {
      const code = match[1];
      // Filter out common false positives
      if (!['THE', 'AND', 'FOR', 'NOT', 'ARE', 'YOU'].includes(code)) {
        allCodes.push(code);
      }
    }

    const uniqueCodes = [...new Set(allCodes)];
    if (uniqueCodes.length >= 2) {
      result.departure = uniqueCodes[0];
      result.arrival = uniqueCodes[1];
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

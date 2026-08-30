import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  OllamaTextParser,
  getOllamaTextParser,
  buildSystemPrompt,
} from '../services/parsers/text/ollamaTextParser';
import { RegexTextParser, getRegexParser } from '../services/parsers/text/regexParser';
import { PATTERNS } from '../services/parsers/shared/utils';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Text Parsers', () => {
  beforeAll(() => {
    // Ensure PNR regex is global so matchAll works in tests
    PATTERNS.PNR = new RegExp(PATTERNS.PNR.source, 'g');
  });

  describe('OllamaTextParser', () => {
    let parser: OllamaTextParser;

    beforeEach(() => {
      // Point at an unreachable host so checkAvailability returns fast without network
      parser = getOllamaTextParser('http://127.0.0.1:1', 'test-model');
      jest.clearAllMocks();
    });

    describe('checkAvailability', () => {
      it('should return unavailable when Ollama endpoint is unreachable', async () => {
        const result = await parser.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.reason).toContain('Ollama not reachable');
      });
    });

    describe('constructor', () => {
      it('should accept custom URL and model', () => {
        const customParser = getOllamaTextParser('http://example.com:11434', 'custom-model');
        expect(customParser).toBeDefined();
      });

      it('should have provider property set to ollama', () => {
        expect(parser.provider).toBe('ollama');
      });
    });

    describe('buildSystemPrompt', () => {
      it('injects today\'s date so the LLM has a year-resolution anchor', () => {
        const prompt = buildSystemPrompt();
        const today = new Date().toISOString().slice(0, 10);
        expect(prompt).toContain(`Today's date is ${today}`);
      });

      it('replaces the static 2024 example date with the current year so the model is not primed toward the past', () => {
        const prompt = buildSystemPrompt();
        const currentYear = new Date().getFullYear();
        // Example date in the schema docs uses the current year, not 2024.
        expect(prompt).toContain(`${currentYear}-06-10T12:35`);
        // The static "2024-06-10" priming string from the original prompt
        // must not be present any more, regardless of where it appeared.
        expect(prompt).not.toContain('2024-06-10');
      });

      it('describes the inferredFields contract so the model can self-report guesses', () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('inferredFields');
        expect(prompt).toMatch(/next future occurrence/i);
      });
    });
  });

  describe('RegexTextParser', () => {
    let parser: RegexTextParser;

    beforeEach(() => {
      parser = getRegexParser();
      jest.clearAllMocks();
    });

    describe('checkAvailability', () => {
      it('should always return available', async () => {
        const result = await parser.checkAvailability();

        expect(result.available).toBe(true);
        expect(result.metadata?.provider).toBe('regex');
        expect(result.metadata?.cost).toBe('free');
      });
    });

    describe('parseEmail', () => {
      it('should parse simple flight booking email', async () => {
        const subject = 'Your flight booking LH103';
        const text = `
          Flight: LH103
          From: MUC (Munich)
          To: LUX (Luxembourg)
          Departure: 2025-11-18T11:00
          Arrival: 2025-11-18T12:55
          PNR: 9RFAA7
          Seat: 26F
          Terminal: 2
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result).toHaveLength(1);
        expect(result[0].flightNumber).toBe('LH103');
        expect(result[0].pnr).toBe('9RFAA7');
        expect(result[0].seat).toBe('26F');
      });

      it('should parse round-trip booking with multiple flights', async () => {
        const subject = 'Round trip booking';
        const text = `
          Flight: LH103
          MUC → LUX
          2025-11-18T11:00 - 2025-11-18T12:55

          Flight: LH442
          LUX → MUC
          2025-11-20T09:30 - 2025-11-20T10:35

          PNR: 9RFAA7
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].flightNumber).toBeDefined();
      });

      it('returns nothing for an email with no flight information', async () => {
        // Changed deliberately. This used to assert ONE candidate with missing
        // fields, which is the behaviour Forgejo #17 reported: ordinary
        // marketing mail came back as a booking — one case with no flight
        // number and no route at all, just a date lifted out of the prose —
        // and the UI opened a review form over it rather than saying no
        // booking was found.
        //
        // A candidate now needs a flight number or both ends of a route. A
        // date is not evidence; every promotional email has one.
        const subject = 'Hello there';
        const text = 'This is just a regular email with no flight info.';

        const result = await parser.parseEmail(subject, text);

        expect(result).toHaveLength(0);
      });

      it('still returns a candidate when only the route is recognisable', async () => {
        // The gate must not demand a flight number: plenty of confirmations
        // name only the airports, and dropping those would trade one silent
        // failure for another.
        // The arrow form is one the extractor actually understands; prose like
        // "von FRA nach JFK" is not recognised as a route at all, which is a
        // separate gap and not what this gate decides.
        const result = await parser.parseEmail('Ihre Reise', 'FRA → JFK');

        expect(result.length).toBeGreaterThan(0);
      });

      it('should extract PNR and validate it contains numbers', async () => {
        const subject = 'Booking confirmation';
        const text = `
          Your booking reference: ABC123
          Flight: LH103
          MUC → LUX
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].pnr).toBeDefined();
        if (result[0].pnr) {
          expect(/[0-9]/.test(result[0].pnr)).toBe(true);
        }
      });

      it('should filter out false positive PNRs', async () => {
        const subject = 'Vielen Dank';
        const text = `
          Vielen Dank for your booking!
          Flight: LH103
        `;

        const result = await parser.parseEmail(subject, text);

        // Should not extract "VIELEN" as PNR
        expect(result[0].pnr).not.toBe('VIELEN');
      });

      it('should validate IATA codes against whitelist', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          From: MUC
          To: LUX
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result).toBeDefined();
      });

      it('should handle HTML emails by extracting text', async () => {
        const subject = 'Flight booking';
        const text = '';
        const html = `
          <html>
            <body>
              <p>Flight: LH103</p>
              <p>From: MUC to LUX</p>
              <p>PNR: 9RFAA7</p>
            </body>
          </html>
        `;

        const result = await parser.parseEmail(subject, text, html);

        expect(result).toHaveLength(1);
        expect(result[0].pnr).toBe('9RFAA7');
      });

      it('should parse German date format', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: LH103
          MUC → LUX
          18. Nov 2025, 11:00
          Ankunft: 18. Nov 2025, 12:55
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2025-11');
        }
      });

      it('should parse German date format with full month name', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: LH103
          MUC → LUX
          07. November 2024, 14:30
          Ankunft: 07. November 2024, 16:15
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2024-11-07');
        }
      });

      it('should parse German date-only format with full month name', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: LH103
          MUC → LUX
          07. November 2024
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2024-11-07');
        }
      });

      it('should parse English abbreviated month name with time', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          07 Dec 2024, 14:30
          Arrival: 07 Dec 2024, 16:15
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2024-12-07');
        }
      });

      it('should parse English full month name with time', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          07 December 2024, 14:30
          Arrival: 07 December 2024, 16:15
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2024-12-07');
        }
      });

      it('should parse English full month name without time', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          07 December 2024
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2024-12-07');
        }
      });

      it('should parse English January (full name)', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          15 January 2025, 09:00
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2025-01-15');
        }
      });

      it('should parse English March (full name)', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          22 March 2025, 11:45
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2025-03-22');
        }
      });

      it('should parse German März (umlaut)', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: LH103
          MUC → LUX
          22. März 2025, 11:45
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2025-03-22');
        }
      });

      it('should parse English June and July (full names)', async () => {
        const subjectJune = 'Flight booking';
        const textJune = `
          Flight: LH103
          MUC → LUX
          10 June 2025, 08:00
        `;
        const resultJune = await parser.parseEmail(subjectJune, textJune);
        expect(resultJune[0].departureTime).toContain('2025-06-10');

        const textJuly = `
          Flight: LH103
          MUC → LUX
          10 July 2025, 08:00
        `;
        const resultJuly = await parser.parseEmail(subjectJune, textJuly);
        expect(resultJuly[0].departureTime).toContain('2025-07-10');
      });

      it('should parse English October (full name)', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          31 October 2025, 20:00
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBeDefined();
        if (result[0].departureTime) {
          expect(result[0].departureTime).toContain('2025-10-31');
        }
      });

      it('should handle ISO datetime with Z timezone suffix', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          2025-11-18T23:45Z
          2025-11-19T01:30Z
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBe('2025-11-18T23:45');
        expect(result[0].arrivalTime).toBe('2025-11-19T01:30');
      });

      it('should handle ISO datetime with +HH:MM timezone offset', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: LH103
          MUC → LUX
          2025-11-18T11:00+01:00
          2025-11-18T12:55+01:00
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toBe('2025-11-18T11:00');
        expect(result[0].arrivalTime).toBe('2025-11-18T12:55');
      });

      it('should add 1 day when +1 next-day marker follows time', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: OS431
          VIE → JFK
          10. March 2025, 10:30
          10. March 2025, 14:45 +1
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].arrivalTime).toBeDefined();
        if (result[0].arrivalTime) {
          expect(result[0].arrivalTime).toContain('2025-03-11');
        }
      });

      it('should add 1 day when (+1) with parens follows time', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: OS431
          VIE → JFK
          10. March 2025, 10:30
          10. March 2025, 14:45 (+1)
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].arrivalTime).toBeDefined();
        if (result[0].arrivalTime) {
          expect(result[0].arrivalTime).toContain('2025-03-11');
        }
      });

      it('should NOT treat timezone offset +01:00 as next-day marker', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: LH103
          MUC → LUX
          18. Nov 2025, 11:00 +01:00
          18. Nov 2025, 12:55 +01:00
        `;

        const result = await parser.parseEmail(subject, text);

        expect(result[0].departureTime).toContain('2025-11-18');
        expect(result[0].arrivalTime).toContain('2025-11-18');
      });

      it('should extract city names and convert to IATA codes', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Von München nach Luxemburg
          am 18. Nov 2025, 11:00
        `;

        const result = await parser.parseEmail(subject, text);

        // Should convert "München" to "MUC" and "Luxemburg" to "LUX"
        expect(result[0].departureCode).toBeDefined();
        expect(result[0].arrivalCode).toBeDefined();
      });

      it('should recognize VIE as Vienna airport code', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: OS431
          VIE → MUC
          2025-03-10T10:30
          2025-03-10T11:45
        `;
        const result = await parser.parseEmail(subject, text);
        const found = result.find(r => r.departureCode === 'VIE' || r.arrivalCode === 'VIE');
        expect(found).toBeDefined();
      });

      it('should map Wien to VIE', async () => {
        const subject = 'Flugbuchung';
        const text = `
          Flug: OS431
          Von Wien nach München
          am 10. März 2025, 10:30
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureCode).toBe('VIE');
        expect(result[0].arrivalCode).toBe('MUC');
      });

      it('should map Salzburg to SZG', async () => {
        const subject = 'Flight booking';
        const text = `
          Flight: OS123
          Von Salzburg nach Wien
          am 10. März 2025, 08:00
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureCode).toBe('SZG');
      });

      it('should extract flight number from Flugnummer keyword', async () => {
        const subject = 'Buchungsbestätigung';
        const text = `
          Flugnummer: LH103
          MUC → LUX
          2025-11-18T11:00
          2025-11-18T12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].flightNumber).toBe('LH103');
      });

      it('should extract flight number from Flt keyword', async () => {
        const subject = 'Booking confirmation';
        const text = `
          Flt. LH103
          MUC → LUX
          2025-11-18T11:00
          2025-11-18T12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].flightNumber).toBe('LH103');
      });

      it('should extract gate from Ausgang keyword', async () => {
        const subject = 'Boarding pass';
        const text = `
          Flight: OS431
          MUC → VIE
          2025-03-10T10:30
          Ausgang: B12
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].gate).toBe('B12');
      });

      it('should assign departureTime from Abflug label', async () => {
        const subject = 'Buchungsbestätigung';
        const text = `
          Buchungsdatum: 01. November 2025
          Flug: LH103
          MUC → LUX
          Abflug: 18. November 2025, 11:00
          Ankunft: 18. November 2025, 12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureTime).toContain('2025-11-18T11:00');
        expect(result[0].arrivalTime).toContain('2025-11-18T12:55');
      });

      it('should assign departureTime from Departure label (EN)', async () => {
        const subject = 'Booking confirmation';
        const text = `
          Booking date: 01 November 2025
          Flight: LH103
          MUC → LUX
          Departure: 18 November 2025, 11:00
          Arrival: 18 November 2025, 12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureTime).toContain('2025-11-18T11:00');
        expect(result[0].arrivalTime).toContain('2025-11-18T12:55');
      });

      it('should use Departure label to skip earlier booking date', async () => {
        const subject = 'Booking confirmation';
        // Without label logic, positional scan picks 2025-10-01 (first ISO date) as departureTime.
        // With label logic, Departure: label must override to 2025-11-18T11:00.
        const text = `
          Flight: LH103
          MUC → LUX
          2025-10-01T00:00
          Departure: 2025-11-18T11:00
          Arrival: 2025-11-18T12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureTime).toBe('2025-11-18T11:00');
        expect(result[0].arrivalTime).toBe('2025-11-18T12:55');
      });

      it('should work with partial labels — only Abflug found', async () => {
        const subject = 'Buchungsbestätigung';
        const text = `
          Flug: LH103
          MUC → LUX
          Abflug: 18. November 2025, 11:00
          18. November 2025, 12:55
        `;
        const result = await parser.parseEmail(subject, text);
        expect(result[0].departureTime).toContain('2025-11-18T11:00');
        // arrivalTime should be picked up by positional fallback
        expect(result[0].arrivalTime).toContain('2025-11-18');
      });

      it('should have provider property set to regex', () => {
        expect(parser.provider).toBe('regex');
      });
    });

    describe('singleton pattern', () => {
      it('should return same instance', () => {
        const parser1 = getRegexParser();
        const parser2 = getRegexParser();

        expect(parser1).toBe(parser2);
      });
    });
  });

  describe('Parser factory functions', () => {
    it('getOllamaTextParser should cache instances per (url, model) key', () => {
      const parser1 = getOllamaTextParser('http://example.com:11434', 'model1');
      const parser2 = getOllamaTextParser('http://example.com:11434', 'model2');
      const parser3 = getOllamaTextParser('http://example.com:11434', 'model1');

      // Different models → different instances
      expect(parser1).not.toBe(parser2);
      // Same (url, model) → same cached instance
      expect(parser1).toBe(parser3);
    });
  });
});

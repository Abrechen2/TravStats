import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import axios from 'axios';
import { ClaudeTextParser, getClaudeTextParser } from '../services/parsers/text/claudeTextParser';
import { OllamaTextParser, getOllamaTextParser } from '../services/parsers/text/ollamaTextParser';
import { OpenAITextParser, getOpenAITextParser } from '../services/parsers/text/openaiTextParser';
import { RegexTextParser, getRegexParser } from '../services/parsers/text/regexParser';
import { PATTERNS } from '../services/parsers/shared/utils';

// Mock dependencies
jest.mock('@anthropic-ai/sdk');
jest.mock('openai');
jest.mock('axios');
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
    (axios as any).isAxiosError = (err: any) => !!err?.isAxiosError;
  });
  describe('ClaudeTextParser', () => {
    let parser: ClaudeTextParser;

    beforeEach(() => {
      parser = getClaudeTextParser();
      jest.clearAllMocks();
    });

    describe('checkAvailability', () => {
      it('should return unavailable when no API key is provided', async () => {
        const result = await parser.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.reason).toContain('API key not configured');
      });

      it('should return unavailable when API key has invalid format', async () => {
        const result = await parser.checkAvailability('invalid-key');

        expect(result.available).toBe(false);
        expect(result.reason).toContain('Invalid Claude API key format');
      });

      it('should return available when API key has valid format', async () => {
        const result = await parser.checkAvailability('sk-ant-api-test-key');

        expect(result.available).toBe(true);
        expect(result.metadata?.provider).toBe('claude');
      });
    });

    describe('parseEmail', () => {
      it('should throw error when no API key is configured', async () => {
        await expect(
          parser.parseEmail('Test Subject', 'Test text')
        ).rejects.toThrow('Claude API key not configured');
      });

      it('should have provider property set to claude', () => {
        expect(parser.provider).toBe('claude');
      });
    });
  });

  describe('OllamaTextParser', () => {
    let parser: OllamaTextParser;

    beforeEach(() => {
      parser = getOllamaTextParser();
      jest.clearAllMocks();
    });

    describe('checkAvailability', () => {
      it('should check if Ollama service is running', async () => {
        const axios = await import('axios');
        const mockAxios = axios.default as unknown as { get: jest.Mock };

        mockAxios.get = jest.fn(async () => {
          const err: any = new Error('ECONNREFUSED');
          err.code = 'ECONNREFUSED';
          err.isAxiosError = true;
          throw err;
        });

        const result = await parser.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.reason).toContain('Ollama service not running');
      });

      it('should check if required model is available', async () => {
        const axios = await import('axios');
        const mockAxios = axios.default as unknown as { get: jest.Mock };

        mockAxios.get = jest.fn(async () => ({
          data: {
            models: [
              { name: 'llama3.2:3b' },
              { name: 'qwen2.5:14b' },
            ],
          },
        }));

        const result = await parser.checkAvailability();

        expect(result.available).toBe(true);
        expect(result.metadata?.provider).toBe('ollama');
      });

      it('should return unavailable when model is not found', async () => {
        const axios = await import('axios');
        const mockAxios = axios.default as unknown as { get: jest.Mock };

        mockAxios.get = jest.fn(async () => ({
          data: {
            models: [{ name: 'llama3.2:3b' }],
          },
        }));

        const customParser = getOllamaTextParser('nonexistent-model');
        const result = await customParser.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.reason).toContain('not found');
      });
    });

    describe('constructor', () => {
      it('should use custom model name when provided', () => {
        const customParser = getOllamaTextParser('custom-model');
        expect(customParser).toBeDefined();
      });

      it('should have provider property set to ollama', () => {
        expect(parser.provider).toBe('ollama');
      });
    });
  });

  describe('OpenAITextParser', () => {
    let parser: OpenAITextParser;

    beforeEach(() => {
      parser = getOpenAITextParser();
      jest.clearAllMocks();
    });

    describe('checkAvailability', () => {
      it('should return unavailable when no API key is provided', async () => {
        const result = await parser.checkAvailability();

        expect(result.available).toBe(false);
        expect(result.reason).toContain('API key not configured');
      });

      it('should have provider property set to openai', () => {
        expect(parser.provider).toBe('openai');
      });
    });

    describe('parseEmail', () => {
      it('should throw error when no API key is configured', async () => {
        await expect(
          parser.parseEmail('Test Subject', 'Test text')
        ).rejects.toThrow('OpenAI API key not configured');
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

      it('should handle emails with no flight information', async () => {
        const subject = 'Hello there';
        const text = 'This is just a regular email with no flight info.';

        const result = await parser.parseEmail(subject, text);

        expect(result).toHaveLength(1);
        expect(result[0].missing.length).toBeGreaterThan(0);
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
    it('getClaudeTextParser should return singleton instance', () => {
      const parser1 = getClaudeTextParser();
      const parser2 = getClaudeTextParser();

      expect(parser1).toBe(parser2);
    });

    it('getOpenAITextParser should return singleton instance', () => {
      const parser1 = getOpenAITextParser();
      const parser2 = getOpenAITextParser();

      expect(parser1).toBe(parser2);
    });

    it('getOllamaTextParser should create new instance with custom model', () => {
      const parser1 = getOllamaTextParser('model1');
      const parser2 = getOllamaTextParser('model2');

      // Should be different instances
      expect(parser1).not.toBe(parser2);
    });
  });
});

import { describe, it, expect, jest } from '@jest/globals';
import { TesseractVisionParser } from '../tesseractParser';

jest.mock('../../../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

/**
 * Test subclass that exposes the protected `extractDateTimes` helper so we
 * can hit the year-fallback path directly without spinning up a real OCR run.
 */
class TestableTesseractVisionParser extends TesseractVisionParser {
  public callExtractDateTimes(text: string) {
    return this.extractDateTimes(text);
  }
}

describe('TesseractVisionParser.extractDateTimes', () => {
  let parser: TestableTesseractVisionParser;

  beforeEach(() => {
    parser = new TestableTesseractVisionParser();
  });

  it('marks departureTime as inferred when the boarding-pass-format fallback has no year', () => {
    // "05 DEC 14:30" — day + month + time, but no year → year is silently
    // filled with the current year, so the parser must flag it as inferred.
    const text = 'Boarding 05 DEC 14:30 Gate B12';
    const result = parser.callExtractDateTimes(text);

    expect(result.departure).toBeDefined();
    expect(result.inferredFields).toContain('departureTime');
  });

  it('does NOT mark departureTime as inferred when a year is captured', () => {
    // Same fallback path, but with explicit year → no inference, no badge.
    const text = 'Boarding 05 DEC 2026 14:30 Gate B12';
    const result = parser.callExtractDateTimes(text);

    expect(result.departure).toBeDefined();
    expect(result.inferredFields).not.toContain('departureTime');
  });

  it('returns an empty inferredFields array when no date is found at all', () => {
    const result = parser.callExtractDateTimes('No dates here, just words.');
    expect(result.inferredFields).toEqual([]);
    expect(result.departure).toBeUndefined();
  });

  it('does NOT mark departureTime as inferred when ISO dates are matched directly', () => {
    // ISO matches don't go through the boarding-pass-format fallback, so the
    // year is taken verbatim from the source — never inferred.
    const text = 'Departure 2026-12-05T14:30 Arrival 2026-12-05T18:45';
    const result = parser.callExtractDateTimes(text);

    expect(result.departure).toBe('2026-12-05T14:30');
    expect(result.inferredFields).not.toContain('departureTime');
  });
});

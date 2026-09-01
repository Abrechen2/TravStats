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

/**
 * What Tesseract actually reads off a Lufthansa Wallet pass, cropped to the
 * card (measured 2026-08-30). Note what is NOT there: a departure time. The
 * two clocks belong to BOARDING and GATE SCHLIESST.
 */
const LUFTHANSA_WALLET_OCR = [
  'GATE',
  'GRP',
  'SITZ',
  'Lufthansa',
  'G 2 8C',
  'MUNCHEN',
  'FRANKFURT',
  'MUC',
  'FRA',
  'FLUG',
  'DATUM',
  'BOARDING',
  'GATE SCHLIESST',
  'LH117',
  '30AUG26',
  '18:30',
  '18:45',
].join('\n');

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

  it('reads the airline date that has no time beside it', () => {
    // "30AUG26" — no separators, two-digit year, and the nearest clock is the
    // BOARDING time a column away. This produced no date at all, so the whole
    // parse was discarded by every caller that requires one.
    const result = parser.callExtractDateTimes(LUFTHANSA_WALLET_OCR);

    expect(result.departure).toBe('2026-08-30T00:00');
    // The year was printed, not guessed.
    expect(result.inferredFields).not.toContain('departureTime');
  });

  it('does not borrow the boarding time as the departure time', () => {
    // 18:30 is when boarding starts. Midnight is this codebase's date-only
    // placeholder; a confident wrong departure time is worse than none.
    expect(parser.callExtractDateTimes(LUFTHANSA_WALLET_OCR).departure).not.toContain(
      '18:30'
    );
  });

  it('does not read an hour as a two-digit year', () => {
    // "30 AUG 18:30" — without the guard the year group swallows "18".
    const result = parser.callExtractDateTimes('DATUM 30 AUG BOARDING 18:30');
    expect(result.departure).toBe(`${new Date().getFullYear()}-08-30T00:00`);
    expect(result.inferredFields).toContain('departureTime');
  });

  it('still prefers a date that DOES carry its own time', () => {
    // The date-only branch is a last resort — it must not shadow a real clock.
    const result = parser.callExtractDateTimes('05 DEC 2026 14:30');
    expect(result.departure).toBe('2026-12-05T14:30');
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

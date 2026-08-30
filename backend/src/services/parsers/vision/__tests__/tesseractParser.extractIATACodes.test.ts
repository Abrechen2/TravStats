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

/** Exposes the protected route picker — see the note on the method itself. */
class TestableTesseractVisionParser extends TesseractVisionParser {
  public callExtractIATACodes(text: string) {
    return this.extractIATACodes(text);
  }
}

/**
 * The OCR of a Lufthansa Wallet pass, uppercased the way `parseOCRText` hands
 * it over. The header labels come FIRST — which is the whole problem.
 */
const LUFTHANSA_WALLET_OCR = [
  'GATE',
  'GRP',
  'SITZ',
  'LUFTHANSA',
  'G 2 8C',
  'MUNCHEN',
  'FRANKFURT',
  'MUC',
  'FRA',
  'FLUG',
  'DATUM',
  'LH117',
  '30AUG26',
  'PASSAGIER',
  'WITTKE, DENNIS MR',
  'FTL LH*S',
].join('\n');

describe('TesseractVisionParser.extractIATACodes', () => {
  let parser: TestableTesseractVisionParser;

  beforeEach(() => {
    parser = new TestableTesseractVisionParser();
  });

  it('reads the route past the column headings above it', () => {
    // Taking the first two three-letter tokens read this pass as GRP → MUC:
    // the boarding-group heading, then the departure airport, destination
    // dropped entirely.
    expect(parser.callExtractIATACodes(LUFTHANSA_WALLET_OCR)).toEqual({
      departure: 'MUC',
      arrival: 'FRA',
    });
  });

  it('still reads an explicit route line first', () => {
    expect(parser.callExtractIATACodes('FROM LUX TO MUC')).toEqual({
      departure: 'LUX',
      arrival: 'MUC',
    });
  });

  it('falls back to reading order for airports it does not know', () => {
    // The whitelist is a shortlist of busy airports, not a world index. Two
    // unknown codes must still produce a route rather than nothing.
    expect(parser.callExtractIATACodes('GRP\nBZG\nKVA\nSEQ')).toEqual({
      departure: 'BZG',
      arrival: 'KVA',
    });
  });

  it('gives no route when the pass shows only one airport', () => {
    const result = parser.callExtractIATACodes('GRP\nMUC\nSEQ');
    expect(result.arrival).toBeUndefined();
  });
});

/**
 * What the OCR returns from the Aztec field once Sauvola thresholding reads
 * more of the card than Otsu did. There are no words in a barcode, so what
 * comes back is a scatter of one- and two-character fragments — and two of
 * them, "kan" and "ple", are three letters long.
 */
const WALLET_OCR_WITH_BARCODE_RUBBLE = [
  'GATE GRP SITZ',
  'G 2 8C',
  'MUNCHEN FRANKFURT',
  'FLUG DATUM BOARDING GATE SCHLIESST',
  'LH117  30AUG26 18:30 18:45',
  'PASSAGIER KLASSE STATUS',
  'WITTKE, DENNISMR ~~ Business FTL LH*S',
  'yt I',
  'ol i kan 24',
  'r ple Tr',
  '“Crh i i',
  '4 rT: Hh',
  'Sec. no. 0077',
].join('\n');

describe('TesseractVisionParser.extractIATACodes — barcode rubble', () => {
  let parser: TestableTesseractVisionParser;

  beforeEach(() => {
    parser = new TestableTesseractVisionParser();
  });

  it('reads the cities rather than the noise under the barcode', () => {
    // This exact pass produced KAN → PLE: a confident, entirely invented
    // route, off a card whose own header says MÜNCHEN and FRANKFURT.
    expect(
      parser.callExtractIATACodes(WALLET_OCR_WITH_BARCODE_RUBBLE.toUpperCase()),
    ).toEqual({ departure: 'MUC', arrival: 'FRA' });
  });

  it('does not harvest three-letter tokens out of rubble lines', () => {
    // Same rubble, no city names to rescue it: the answer must be nothing
    // rather than KAN → PLE.
    const rubbleOnly = ['yt I', 'ol i kan 24', 'r ple Tr', '4 rT: Hh'].join('\n');
    const result = parser.callExtractIATACodes(rubbleOnly.toUpperCase());
    expect(result.departure).toBeUndefined();
    expect(result.arrival).toBeUndefined();
  });

  it('keeps a short genuine line that a blunter filter would eat', () => {
    // "MUC = FRA" is three tokens, one of them a stray glyph — the filter has
    // to be generous enough to leave it alone.
    expect(parser.callExtractIATACodes('MUC = FRA')).toEqual({
      departure: 'MUC',
      arrival: 'FRA',
    });
  });

  it('needs two different cities before it claims a route', () => {
    // One city says nothing about direction; the same city twice is a misread.
    const result = parser.callExtractIATACodes('MUNCHEN\nMUNCHEN\nLH117');
    expect(result.arrival).toBeUndefined();
  });
});

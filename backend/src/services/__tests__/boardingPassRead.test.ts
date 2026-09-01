import { isEmpty, readBoardingPass } from '../boardingPassRead';
import { decodeBarcodeFromImageBase64 } from '../../utils/barcodeImage';
import { parseBoardingPass } from '../parsers/factory';

/**
 * The half `/parse-boardingpass` and `/boardingpass/propose` share. Both real
 * halves are mocked: one is a WASM barcode decoder, the other an OCR run, and
 * what is under test here is the seam between them.
 */
jest.mock('../../utils/barcodeImage', () => ({
  decodeBarcodeFromImageBase64: jest.fn(),
}));

jest.mock('../parsers/factory', () => ({
  ...jest.requireActual('../parsers/factory'),
  getParserConfig: jest.fn().mockResolvedValue({}),
  parseBoardingPass: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedBarcode = decodeBarcodeFromImageBase64 as jest.Mock;
const mockedOcr = parseBoardingPass as jest.Mock;

/** A real Lufthansa Wallet pass: LH117, MUC-FRA, day 242, seat 8C, PNR 9VLVKC. */
const BCBP =
  'M1WITTKE/DENNIS       E9VLVKC MUCFRALH 0117 242C008C0077 377>8320 M    BLH';

const ocrResult = (flight: Record<string, unknown>) => ({
  flights: [flight],
  provider: 'tesseract',
  fallbackUsed: false,
});

const IMAGE = 'BASE64IMAGE';
const USER = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockedBarcode.mockResolvedValue(null);
  mockedOcr.mockResolvedValue(ocrResult({ missing: [] }));
});

describe('readBoardingPass — where each field comes from', () => {
  it('lets the barcode win every field it carries', async () => {
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(
      ocrResult({ flightNumber: 'LH999', departureCode: 'GRP', arrivalCode: 'MUC', missing: [] })
    );

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged).toMatchObject({
      flightNumber: 'LH117',
      departureCode: 'MUC',
      arrivalCode: 'FRA',
      seat: '8C',
      pnr: '9VLVKC',
    });
  });

  it('keeps the four fields no BCBP string holds', async () => {
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(
      ocrResult({ gate: 'G28', terminal: '2', boardingGroup: '2', aircraft: 'A320', missing: [] })
    );

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged).toMatchObject({
      gate: 'G28',
      terminal: '2',
      boardingGroup: '2',
      aircraft: 'A320',
    });
  });

  it('prefers the airline NAME over the carrier code, the one field the barcode loses', async () => {
    // The barcode carries "LH"; the card prints "Lufthansa". The name is worth
    // more to every caller, and the code is derivable from the flight number.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(ocrResult({ airline: 'Lufthansa', missing: [] }));

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged.airline).toBe('Lufthansa');
  });

  it('falls back to the carrier code when OCR read no name', async () => {
    mockedBarcode.mockResolvedValue(BCBP);

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged.airline).toBe('LH');
  });

  it('stamps a barcode date at midnight, the date-only placeholder', async () => {
    // A BCBP string holds a day of the year and no clock at all.
    mockedBarcode.mockResolvedValue(BCBP);

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged.departureTime).toMatch(/^\d{4}-08-30T00:00$/);
  });

  it('recomputes what is missing after the merge', async () => {
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(
      ocrResult({ missing: ['flightNumber', 'departureCode', 'arrivalCode'] })
    );

    const { merged } = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(merged.missing).not.toContain('flightNumber');
    expect(merged.missing).toContain('arrivalTime');
  });
});

describe('readBoardingPass — the two callers use it differently', () => {
  it('trusts a supplied barcode over re-reading one from the image', async () => {
    // The live scanner decodes from a camera frame and sends no photograph;
    // re-reading a JPEG of the same card would be strictly worse.
    await readBoardingPass({ barcode: BCBP, userId: USER });
    expect(mockedBarcode).not.toHaveBeenCalled();
  });

  it('works with a barcode and no image at all', async () => {
    const reading = await readBoardingPass({ barcode: BCBP, userId: USER });
    expect(reading.merged.flightNumber).toBe('LH117');
    expect(reading.sources).toEqual({ barcode: true, ocr: false });
    expect(mockedOcr).not.toHaveBeenCalled();
  });

  it('still reads the barcode out of an image OCR is not allowed to touch', async () => {
    // An image that failed validation can hold a perfectly good barcode.
    mockedBarcode.mockResolvedValue(BCBP);

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER, allowOcr: false });

    expect(reading.merged.flightNumber).toBe('LH117');
    expect(mockedOcr).not.toHaveBeenCalled();
    expect(reading.sources).toEqual({ barcode: true, ocr: false });
  });
});

describe('readBoardingPass — when a half fails', () => {
  it('survives an OCR failure once the barcode decoded', async () => {
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockRejectedValue(new Error('tesseract exploded'));

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(reading.merged.flightNumber).toBe('LH117');
    expect(reading.sources).toEqual({ barcode: true, ocr: false });
  });

  it('rethrows an OCR failure when there is no barcode to fall back on', async () => {
    // Nothing was read at all; the caller must see the real error, not a
    // silently empty result.
    mockedOcr.mockRejectedValue(new Error('tesseract exploded'));

    await expect(readBoardingPass({ imageBase64: IMAGE, userId: USER })).rejects.toThrow(
      'tesseract exploded'
    );
  });

  it('ignores a barcode that is not a boarding pass', async () => {
    // A QR code on the same page, a baggage tag, a loyalty card.
    mockedBarcode.mockResolvedValue('https://example.com/not-a-pass');
    mockedOcr.mockResolvedValue(ocrResult({ flightNumber: 'LH103', missing: [] }));

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(reading.decoded).toBeNull();
    expect(reading.merged.flightNumber).toBe('LH103');
    expect(reading.sources.barcode).toBe(false);
  });

  it('reports an empty reading so callers can answer 422', async () => {
    mockedOcr.mockResolvedValue({ flights: [], provider: 'tesseract', fallbackUsed: true });

    const reading = await readBoardingPass({ imageBase64: IMAGE, userId: USER });

    expect(isEmpty(reading)).toBe(true);
  });

  it('is not empty when only one half answered', async () => {
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue({ flights: [], provider: 'tesseract', fallbackUsed: true });

    expect(isEmpty(await readBoardingPass({ imageBase64: IMAGE, userId: USER }))).toBe(false);
  });
});

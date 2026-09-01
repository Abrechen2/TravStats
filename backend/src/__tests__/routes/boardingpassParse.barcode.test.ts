import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';
import { decodeBarcodeFromImageBase64 } from '../../utils/barcodeImage';
import { parseBoardingPass } from '../../services/parsers/factory';

/**
 * POST /parse-boardingpass reads the pass's barcode as well as its printed
 * text. This suite is about the SEAM between the two — which half wins which
 * field, and what happens when one of them produces nothing. Both halves are
 * mocked: the real ones are an OCR run and a WASM decoder, neither of which
 * belongs in a route test.
 */
jest.mock('../../utils/barcodeImage', () => ({
  decodeBarcodeFromImageBase64: jest.fn(),
}));

jest.mock('../../services/parsers/factory', () => ({
  ...jest.requireActual('../../services/parsers/factory'),
  parseBoardingPass: jest.fn(),
}));

const mockedBarcode = decodeBarcodeFromImageBase64 as jest.Mock;
const mockedOcr = parseBoardingPass as jest.Mock;

/** A real 1x1 PNG — the route checks magic numbers before it does anything. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The Aztec of a real Lufthansa Wallet pass: LH117, MUC-FRA, day 242, seat 8C. */
const BCBP =
  'M1WITTKE/DENNIS       E9VLVKC MUCFRALH 0117 242C008C0077 377>8320 M    BLH';

/** What OCR alone made of the same card before any of this: nothing usable. */
const OCR_EMPTY = {
  flights: [{ missing: ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime', 'arrivalTime'] }],
  provider: 'tesseract',
  fallbackUsed: false,
};

const post = (token: string) =>
  request(app)
    .post('/api/v1/parse-boardingpass')
    .set('Cookie', [`auth_token=${token}`])
    .send({ imageBase64: PNG, enrichWithApi: false });

describe('POST /parse-boardingpass — barcode and OCR together', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `bp-barcode-test-${Date.now()}`,
        passwordHash: await hashPassword('password123'),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(() => jest.clearAllMocks());

  it('answers the flight from the barcode when OCR reads nothing', async () => {
    // The whole point: this exact case used to be a 422 or an unusable 200,
    // with the answer sitting in the middle of the picture the caller sent.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(OCR_EMPTY);

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(res.body.flight).toMatchObject({
      flightNumber: 'LH117',
      departureCode: 'MUC',
      arrivalCode: 'FRA',
      seat: '8C',
    });
    expect(res.body.flight.departureTime).toMatch(/^\d{4}-08-30T00:00$/);
    expect(res.body.sources).toEqual({ barcode: true, ocr: true });
  });

  it('lets the barcode overrule a route OCR got wrong', async () => {
    // OCR misreading the route is the failure this parser keeps producing; the
    // barcode is error-corrected, so it wins wherever both have an opinion.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue({
      flights: [{ flightNumber: 'LH999', departureCode: 'GRP', arrivalCode: 'MUC', missing: [] }],
      provider: 'tesseract',
      fallbackUsed: false,
    });

    const { body } = await post(token);

    expect(body.flight).toMatchObject({
      flightNumber: 'LH117',
      departureCode: 'MUC',
      arrivalCode: 'FRA',
    });
  });

  it('keeps the printed fields no barcode carries', async () => {
    // Gate, terminal, boarding group and aircraft are not in a BCBP string, so
    // OCR is the only source for them and must survive the merge.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue({
      flights: [{ gate: 'G28', terminal: '2', boardingGroup: '2', missing: [] }],
      provider: 'tesseract',
      fallbackUsed: false,
    });

    const { body } = await post(token);

    expect(body.flight).toMatchObject({ gate: 'G28', terminal: '2', boardingGroup: '2' });
    expect(body.flight.flightNumber).toBe('LH117');
  });

  it('recomputes what is missing after the merge', async () => {
    // `missing` came from the OCR pass alone; left alone it names fields the
    // barcode has since supplied.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockResolvedValue(OCR_EMPTY);

    const { body } = await post(token);

    expect(body.flight.missing).not.toContain('flightNumber');
    expect(body.flight.missing).not.toContain('departureCode');
    // A boarding pass genuinely does not print an arrival time.
    expect(body.flight.missing).toContain('arrivalTime');
  });

  it('survives an OCR failure when the barcode decoded', async () => {
    // Losing the gate must not cost a flight the barcode already spelled out.
    mockedBarcode.mockResolvedValue(BCBP);
    mockedOcr.mockRejectedValue(new Error('tesseract exploded'));

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(res.body.flight.flightNumber).toBe('LH117');
    expect(res.body.sources).toEqual({ barcode: true, ocr: false });
  });

  it('still reads a pass whose barcode is unreadable', async () => {
    // The ordinary case this route was built for: a photo with no decodable
    // barcode. OCR alone still answers.
    mockedBarcode.mockResolvedValue(null);
    mockedOcr.mockResolvedValue({
      flights: [{ flightNumber: 'LH103', departureCode: 'MUC', arrivalCode: 'FRA', missing: [] }],
      provider: 'tesseract',
      fallbackUsed: false,
    });

    const { status, body } = await post(token);

    expect(status).toBe(200);
    expect(body.flight.flightNumber).toBe('LH103');
    expect(body.sources).toEqual({ barcode: false, ocr: true });
  });

  it('ignores a barcode that is not a boarding pass', async () => {
    // A QR code on the same page, a baggage tag, a loyalty card.
    mockedBarcode.mockResolvedValue('https://example.com/not-a-pass');
    mockedOcr.mockResolvedValue({
      flights: [{ flightNumber: 'LH103', departureCode: 'MUC', arrivalCode: 'FRA', missing: [] }],
      provider: 'tesseract',
      fallbackUsed: false,
    });

    const { body } = await post(token);

    expect(body.flight.flightNumber).toBe('LH103');
    expect(body.sources.barcode).toBe(false);
  });

  it('is a 422 only when neither half produced anything', async () => {
    mockedBarcode.mockResolvedValue(null);
    mockedOcr.mockResolvedValue({ flights: [], provider: 'tesseract', fallbackUsed: true });

    const res = await post(token);

    expect(res.status).toBe(422);
  });
});

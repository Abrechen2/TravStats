import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Route-level contract for POST /api/v1/parse-image (Forgejo #58).
 *
 * Everything expensive behind the route is mocked, for the same reason
 * `parser.domain.test.ts` mocks the parsers: the flight and cruise paths dial a
 * real Ollama instance and a 12b inference legitimately blows the 30s per-test
 * cap, which turns the suite into a flaky gate blocker. OCR is worse still —
 * Tesseract on a real photograph costs seconds of CPU and would make this suite
 * a benchmark of the test machine rather than a check of the route.
 *
 * So the two ends are faked and the middle is real: OCR text goes in as a
 * literal, the parsers answer instantly with an empty result, and the parts this
 * file actually cares about — auth, image validation, the `auto` default, the
 * classifier, the response envelope — all run for real.
 *
 * The image itself is NOT mocked. `validateBoardingPassImageBase64` sniffs magic
 * numbers, and stubbing it out would leave the 400-before-OCR guard untested, so
 * the fixtures below are a genuine 1x1 PNG and genuine non-image bytes.
 */

const mockRecognizeText = jest.fn<Promise<{ text: string; confidence: number }>, [string]>();

jest.mock("../../services/parsers/vision/tesseractParser", () => ({
  getTesseractParser: () => ({ recognizeText: mockRecognizeText }),
}));

jest.mock("../../services/bookingParser", () => ({
  ...jest.requireActual("../../services/bookingParser"),
  parseBookingText: jest.fn(async () => ({
    flights: [],
    parserUsed: "regex",
    ollamaAvailable: false,
  })),
  parseBookingEmail: jest.fn(async () => ({
    flights: [],
    parserUsed: "regex",
    ollamaAvailable: false,
  })),
}));

jest.mock("../../services/cruiseBookingParser", () => ({
  ...jest.requireActual("../../services/cruiseBookingParser"),
  parseCruiseBookingText: jest.fn(async () => ({
    cruises: [],
    parserUsed: "ollama",
    ollamaAvailable: false,
  })),
}));

jest.mock("../../services/lodging/lodgingBookingParser", () => ({
  ...jest.requireActual("../../services/lodging/lodgingBookingParser"),
  parseLodgingBookingText: jest.fn(async () => ({
    bookings: [],
    parserUsed: "template",
    ollamaAvailable: false,
  })),
}));

import { parseBookingText } from "../../services/bookingParser";
import { parseLodgingBookingText } from "../../services/lodging/lodgingBookingParser";

const mockParseBookingText = parseBookingText as jest.MockedFunction<typeof parseBookingText>;
const mockParseLodgingBookingText = parseLodgingBookingText as jest.MockedFunction<
  typeof parseLodgingBookingText
>;

/**
 * A real 1x1 PNG. The route's first act is magic-number validation, so a
 * placeholder string would never reach OCR and every success case would be
 * testing the 400 path by accident.
 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Valid base64, but the decoded bytes are the ASCII text "not an image". */
const NOT_AN_IMAGE_BASE64 = "bm90IGFuIGltYWdl";

/**
 * Hotel-shaped OCR text. Deliberately scores on the LODGING structural signals
 * (check-in beside check-out, a night count, a room category) and on none of the
 * flight ones — no flight number, no IATA pair — so a wrong classification here
 * is a real regression and not a coin toss.
 */
const HOTEL_OCR_TEXT = [
  "Buchungsbestaetigung Hotel Adlerhof",
  "Check-in: 05.01.2026",
  "Check-out: 07.01.2026",
  "2 Naechte, Doppelzimmer, 2 Gaeste",
  "Fruehstueck inklusive",
].join("\n");

/** A record-shaped response body, without reaching for `any`. */
const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected an object response body, received: ${typeof value}`);
  }
  return value as Record<string, unknown>;
};

describe("POST /api/v1/parse-image", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `parse-image-test-${Date.now()}`,
        passwordHash: await hashPassword("password123"),
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecognizeText.mockResolvedValue({ text: HOTEL_OCR_TEXT, confidence: 87.5 });
  });

  // -----------------------------------------------------------------------
  // Access
  // -----------------------------------------------------------------------

  it("requires authentication", async () => {
    // OCR is expensive and the parsers can reach an LLM, so this endpoint must
    // never be usable without a session — same rule as every other parse route.
    const res = await request(app).post("/api/v1/parse-image").send({
      imageBase64: TINY_PNG_BASE64,
    });

    expect(res.status).toBe(401);
    expect(mockRecognizeText).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // The default really is `auto`
  // -----------------------------------------------------------------------

  it("defaults to auto and classifies a hotel confirmation as lodging", async () => {
    // This is the entire premise of the endpoint. The text routes default to
    // `flight` for backwards compatibility; a photograph has no caller history
    // to preserve, so this one defaults to `auto`. If that default ever slid
    // back to `flight` the route would still answer 200 with an empty flight
    // result, and nothing else in the suite would notice.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64 });

    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    expect(body.domain).toBe("lodging");
    expect(mockParseLodgingBookingText).toHaveBeenCalledTimes(1);
    expect(mockParseBookingText).not.toHaveBeenCalled();
  });

  it("marks a server-decided domain with domainSource=detected and the candidates", async () => {
    // A client that sent `auto` must be able to tell a decision was made on its
    // behalf, and must get the runners-up so it can offer a switch without a
    // second round trip. Answering as if the caller had asked for lodging is
    // exactly how the "send it three times" workaround survives.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64, domain: "auto" });

    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    expect(body.domainSource).toBe("detected");

    const detection = asRecord(body.detection);
    expect(detection.domain).toBe("lodging");
    expect(Array.isArray(detection.candidates)).toBe(true);
    expect((detection.candidates as unknown[]).length).toBeGreaterThan(1);
    expect(typeof detection.confidence).toBe("number");
  });

  // -----------------------------------------------------------------------
  // Explicit domains keep the old envelope
  // -----------------------------------------------------------------------

  it("routes an explicit domain=flight to the flight parser without consulting the classifier", async () => {
    // The OCR text is hotel-shaped on purpose: if the classifier had a say, this
    // would come back as lodging. The caller named a domain, so it must not.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64, domain: "flight" });

    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    expect(body.domain).toBe("flight");
    expect(mockParseBookingText).toHaveBeenCalledTimes(1);
    expect(mockParseLodgingBookingText).not.toHaveBeenCalled();
  });

  it("omits domainSource and detection entirely when the caller named the domain", async () => {
    // The backwards-compatibility contract: a caller that already knows what it
    // sent gets byte-identical body keys to the pre-`auto` routes. Reporting a
    // "detection" for a decision the server never made would be a lie, and a
    // client keying off the presence of the field would mis-read it.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64, domain: "flight" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("domainSource");
    expect(res.body).not.toHaveProperty("detection");
  });

  // -----------------------------------------------------------------------
  // OCR reporting
  // -----------------------------------------------------------------------

  it("reports ocrConfidence and ocrTextLength on a successful parse", async () => {
    // Reported, never used as a gate — a client shows it beside a thin result to
    // explain why. It only helps if it is actually there, so pin it.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64 });

    expect(res.status).toBe(200);
    const body = asRecord(res.body);
    expect(body.ocrConfidence).toBe(87.5);
    expect(body.ocrTextLength).toBe(HOTEL_OCR_TEXT.length);
  });

  it("answers 422 with the confidence when OCR read too little text to parse", async () => {
    // A photograph of a wall comes back as a handful of stray glyphs. Handing
    // those to a parser burns an LLM round trip and produces an empty 200 that
    // reads as "we could not understand your document" when the truth is "there
    // was nothing on it". The confidence travels with the refusal so the client
    // can say which of the two it was.
    mockRecognizeText.mockResolvedValue({ text: "AB\n  cd ", confidence: 12.5 });

    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: TINY_PNG_BASE64 });

    expect(res.status).toBe(422);
    const body = asRecord(res.body);
    expect(body.error).toBe("No readable text");
    expect(body.ocrConfidence).toBe(12.5);
    expect(mockParseLodgingBookingText).not.toHaveBeenCalled();
    expect(mockParseBookingText).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Guards in front of the expensive work
  // -----------------------------------------------------------------------

  it("rejects a non-image payload with 400 before spending any OCR", async () => {
    // Skipping OCR is the whole point of this guard — running Tesseract over
    // arbitrary uploaded bytes is the cost it exists to avoid, so asserting the
    // status alone would miss a regression that validated and then OCR'd anyway.
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ imageBase64: NOT_AN_IMAGE_BASE64 });

    expect(res.status).toBe(400);
    const body = asRecord(res.body);
    expect(body.error).toBe("Validation failed");
    expect(String(body.message)).toContain("Image validation failed");
    expect(mockRecognizeText).not.toHaveBeenCalled();
  });

  it("rejects a body without imageBase64 at the schema layer", async () => {
    const res = await request(app)
      .post("/api/v1/parse-image")
      .set("Cookie", [`auth_token=${token}`])
      .send({ domain: "lodging" });

    expect(res.status).toBe(400);
    expect(asRecord(res.body).error).toBe("Validation failed");
    expect(mockRecognizeText).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const parseBookingEmail =
  jest.fn<
    (subject?: string, text?: string, html?: string, settings?: unknown) => Promise<unknown>
  >();
const parseBookingText = jest.fn<(text: string, userId?: string) => Promise<unknown>>();
const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
const parseLodgingBookingText =
  jest.fn<(text: string, options?: unknown, userId?: string) => Promise<unknown>>();

jest.mock("../../services/bookingParser", () => ({
  parseBookingEmail: (...args: unknown[]) =>
    parseBookingEmail(...(args as Parameters<typeof parseBookingEmail>)),
  parseBookingText: (...args: unknown[]) =>
    parseBookingText(...(args as Parameters<typeof parseBookingText>)),
}));
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));
jest.mock("../../services/lodging/lodgingBookingParser", () => ({
  parseLodgingBookingText: (...args: unknown[]) =>
    parseLodgingBookingText(...(args as Parameters<typeof parseLodgingBookingText>)),
}));

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * `POST /documents/:id/extract-values` — the parser pipeline on a kept
 * document, answering the cost-block fields as a proposal. The parsers are
 * stubbed: what is pinned is the plumbing around them — the kept bytes reach
 * the parser with the caller's id (which is how their parser settings apply),
 * the leg of a multi-flight booking is picked or abstained on, amounts are
 * read in either grouping convention, "nothing found" is said as such, and no
 * other account's document is readable.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PDF_TEXT = "Buchungsbestaetigung Lufthansa LH1234 Frankfurt nach Muenchen, Gesamtpreis";

const LEG = (flightNumber: string, departureTime: string, extra: Record<string, unknown> = {}) => ({
  flightNumber,
  departureTime,
  missing: [],
  ...extra,
});

describe("POST /api/v1/documents/:id/extract-values", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;

  const extract = (id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/documents/${id}/extract-values`).set("Cookie", cookie).send(body);

  const keptPdf = async (tag: string) =>
    (await createDocument({ userId, buffer: PDF(`${tag}-${stamp}`) })).document.id;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (
      await prisma.user.create({ data: { username: `extract-values-${stamp}`, passwordHash } })
    ).id;
    strangerId = (
      await prisma.user.create({ data: { username: `extract-values-o-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    parseBookingEmail.mockReset();
    parseBookingText.mockReset();
    extractTextFromPdf.mockReset();
    parseLodgingBookingText.mockReset();
    extractTextFromPdf.mockResolvedValue(PDF_TEXT);
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("proposes the matching leg's price, currency, booking code, seat and class", async () => {
    parseBookingText.mockResolvedValue({
      parserUsed: "regex",
      ollamaAvailable: false,
      flights: [
        LEG("LH 1234", "2026-05-01T08:00", {
          price: "1.234,50",
          currency: "eur",
          pnr: "ABC123",
          seat: "12A",
          seatClass: "Business Saver",
        }),
        LEG("LH1235", "2026-05-08T18:00", { price: "1.234,50", seat: "30C" }),
      ],
    });
    const id = await keptPdf("legs");

    const res = await extract(id, { domain: "flight", flightNumber: "LH1234" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        domain: "flight",
        parserUsed: "regex",
        values: {
          price: 1234.5,
          currency: "EUR",
          bookingReference: "ABC123",
          seatNumber: "12A",
          seatClass: "business",
        },
        reason: null,
      },
    });
    // The caller's id reaches the parser — that is how their settings apply.
    expect(parseBookingText).toHaveBeenCalledWith(PDF_TEXT, userId);
    const document = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(document.parsedDomain).toBe("flight");
  });

  it("abstains on seat and class when the leg cannot be told, keeping what every leg agrees on", async () => {
    parseBookingText.mockResolvedValue({
      parserUsed: "regex",
      ollamaAvailable: false,
      flights: [
        LEG("LH1234", "2026-05-01T08:00", { price: "300", pnr: "ABC123", seat: "12A" }),
        LEG("LH1235", "2026-05-08T18:00", { price: "300", pnr: "ABC123", seat: "30C" }),
      ],
    });
    const res = await extract(await keptPdf("ambiguous"), { domain: "flight" });
    expect(res.body.data.values).toEqual({
      price: 300,
      currency: null,
      bookingReference: "ABC123",
      seatNumber: null,
      seatClass: null,
    });
  });

  it("reads a stay's total out of a kept mail", async () => {
    parseLodgingBookingText.mockResolvedValue({
      parserUsed: "template",
      ollamaAvailable: false,
      bookings: [
        {
          hotelName: "Hotel Forum",
          totalPrice: 412.8,
          currency: "EUR",
          confirmationNumber: "4711",
        },
      ],
    });
    const { document } = await createDocument({
      userId,
      buffer: Buffer.from(`Ihre Buchung im Hotel Forum, Rom. Bestaetigung 4711. ${stamp}`),
      declaredFormat: "emailText",
    });

    const res = await extract(document.id, { domain: "lodging" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      domain: "lodging",
      values: { price: 412.8, currency: "EUR", bookingReference: "4711", seatNumber: null },
    });
    expect(parseLodgingBookingText.mock.calls[0][2]).toBe(userId);
  });

  it("says so plainly when the parser found nothing, and when there was no text", async () => {
    parseBookingText.mockResolvedValue({
      parserUsed: "regex",
      ollamaAvailable: false,
      flights: [],
    });
    const nothing = await extract(await keptPdf("nothing"), { domain: "flight" });
    expect(nothing.body.data).toMatchObject({ values: null, reason: "nothingFound" });

    extractTextFromPdf.mockResolvedValue("1");
    const scan = await extract(await keptPdf("scan"), { domain: "flight" });
    expect(scan.body.data).toMatchObject({ values: null, reason: "noText" });
    expect(parseBookingText).toHaveBeenCalledTimes(1);
  });

  it("refuses an image with 415 and runs no parser", async () => {
    const { document } = await createDocument({
      userId,
      buffer: Buffer.concat([Buffer.from(PNG_1x1, "base64"), Buffer.from(String(stamp))]),
    });
    const res = await extract(document.id, { domain: "flight" });
    expect(res.status).toBe(415);
    expect(parseBookingText).not.toHaveBeenCalled();
  });

  it("never reads another account's document", async () => {
    const foreign = await createDocument({ userId: strangerId, buffer: PDF(`foreign-${stamp}`) });
    const res = await extract(foreign.document.id, { domain: "flight" });
    expect(res.status).toBe(404);
    expect(extractTextFromPdf).not.toHaveBeenCalled();
  });

  it("400s on a domain it cannot parse", async () => {
    const res = await extract(await keptPdf("bad"), { domain: "placeVisit" });
    expect(res.status).toBe(400);
  });

  it("refuses a read-scoped token: the reading it records replaces the document's", async () => {
    const tok = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "extract-read",
        lookupHash: tok.lookupHash,
        hash: tok.hash,
        scope: "read",
      },
    });
    const id = await keptPdf("read-scope");

    const res = await request(app)
      .post(`/api/v1/documents/${id}/extract-values`)
      .set("Authorization", `Bearer ${tok.plaintext}`)
      .send({ domain: "flight" });

    expect(res.status).toBe(403);
    expect(extractTextFromPdf).not.toHaveBeenCalled();
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).parsedPayload).toBeNull();
  });
});

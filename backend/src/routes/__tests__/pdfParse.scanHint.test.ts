import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));
const parseLodgingBookingText = jest.fn<() => Promise<unknown>>();
jest.mock("../../services/lodging/lodgingBookingParser", () => ({
  ...jest.requireActual<object>("../../services/lodging/lodgingBookingParser"),
  parseLodgingBookingText: () => parseLodgingBookingText(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A scanned PDF is not a text PDF with nothing in it (sandbox run 2026-09-17,
 * QA-003). Its text layer was twelve stray characters, the route checked only
 * for EMPTY text, and so a scanned hotel invoice answered 200 with no
 * candidates and no word about where it belongs. It now gets the 422 that
 * names /parse-image, before the parser spends anything on it.
 */
describe("POST /api/v1/parse-pdf — a scan says so", () => {
  let userId: string;
  let cookie: string;
  const PDF = Buffer.from("%PDF-1.4\n%%EOF").toString("base64");

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `pdf-scan-${Date.now()}`,
          passwordHash: await hashPassword("password123"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  beforeEach(() => {
    extractTextFromPdf.mockReset();
    parseLodgingBookingText.mockReset();
    parseLodgingBookingText.mockResolvedValue({ bookings: [], parserUsed: "template" });
  });

  it("answers 422 with the way to /parse-image when the text layer is a few stray glyphs", async () => {
    extractTextFromPdf.mockResolvedValue("  \n Seite 1/1 \f ");

    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF, domain: "lodging" });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain("/parse-image");
    expect(parseLodgingBookingText).not.toHaveBeenCalled();
  });

  it("still parses a PDF with a real text layer", async () => {
    extractTextFromPdf.mockResolvedValue(
      "Hotel Adlon Berlin — Rechnung. Anreise 01.05.2024, Abreise 04.05.2024, 3 Nächte, Gesamt 402,00 EUR"
    );

    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF, domain: "lodging" });

    expect(res.status).toBe(200);
    expect(parseLodgingBookingText).toHaveBeenCalledTimes(1);
  });
});

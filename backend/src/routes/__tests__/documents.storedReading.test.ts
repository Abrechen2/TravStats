import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";

const parseBookingText = jest.fn<(text: string, userId?: string) => Promise<unknown>>();
const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();

jest.mock("../../services/bookingParser", () => ({
  parseBookingEmail: jest.fn(),
  parseBookingText: (...args: unknown[]) =>
    parseBookingText(...(args as Parameters<typeof parseBookingText>)),
}));
jest.mock("../../services/pdfParser", () => ({
  extractTextFromPdf: (buffer: Buffer) => extractTextFromPdf(buffer),
  isBcbpText: () => false,
}));

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * forgejo#132 item 3: a document carries the values its stored reading holds,
 * so the phone stops re-running `extract-values` (parser budget, and a minute
 * with the LLM on) just to SHOW what the server already read. Pinned: the
 * values come back without any parser call, a leg is picked by hints, and "not
 * parsed", "unreadable" and "nothing found" are told apart.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

const TWO_LEGS = {
  domain: "flight",
  parserUsed: "regex",
  llmDisabledByAdmin: false,
  flights: [
    {
      flightNumber: "LH 1234",
      departureTime: "2026-05-01T08:00",
      price: "1.234,50",
      currency: "eur",
      pnr: "ABC123",
      seat: "12A",
      seatClass: "Business Saver",
    },
    {
      flightNumber: "LH1235",
      departureTime: "2026-05-08T18:00",
      price: "1.234,50",
      currency: "EUR",
      pnr: "ABC123",
      seat: "30C",
    },
  ],
};

describe("the stored reading of a kept document", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerCookie: string;
  let cookie: string;

  const kept = async (tag: string, payload: unknown | null) =>
    (
      await createDocument({
        userId,
        buffer: PDF(`${tag}-${stamp}`),
        ...(payload === null
          ? {}
          : { parsedDomain: "flight", parsedPayload: payload as Prisma.InputJsonValue }),
      })
    ).document.id;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (
      await prisma.user.create({ data: { username: `stored-read-${stamp}`, passwordHash } })
    ).id;
    const stranger = await prisma.user.create({
      data: { username: `stored-read-o-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
  });

  beforeEach(() => {
    parseBookingText.mockReset();
    extractTextFromPdf.mockReset();
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { user: { username: { startsWith: "stored-read-" } } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: "stored-read-" } } });
  });

  it("GET /documents/:id carries the booking-wide values, without parsing again", async () => {
    const id = await kept("dto", TWO_LEGS);
    const res = await request(app).get(`/api/v1/documents/${id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.parsedValues).toEqual({
      price: 1234.5,
      currency: "EUR",
      bookingReference: "ABC123",
      // Two legs and no hint: the seat of one is not the seat of the other.
      seatNumber: null,
      seatClass: null,
    });
    expect(parseBookingText).not.toHaveBeenCalled();
    expect(extractTextFromPdf).not.toHaveBeenCalled();
  });

  it("GET /documents/:id/stored-values picks the entry's leg by its flight number", async () => {
    const id = await kept("leg", TWO_LEGS);
    const res = await request(app)
      .get(`/api/v1/documents/${id}/stored-values?flightNumber=LH1234`)
      .set("Cookie", cookie);
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
    expect(parseBookingText).not.toHaveBeenCalled();
  });

  it("says a document was never parsed, rather than answering empty values", async () => {
    const id = await kept("unparsed", null);
    const dto = await request(app).get(`/api/v1/documents/${id}`).set("Cookie", cookie);
    expect(dto.body.data.parsedValues).toBeNull();
    const res = await request(app)
      .get(`/api/v1/documents/${id}/stored-values`)
      .set("Cookie", cookie);
    expect(res.body.data).toEqual({
      domain: null,
      parserUsed: null,
      values: null,
      reason: "notParsed",
    });
  });

  it("refuses a stored body of an unknown shape instead of reading half of it", async () => {
    const id = await kept("odd", { domain: "flight", flights: "not a list" });
    const dto = await request(app).get(`/api/v1/documents/${id}`).set("Cookie", cookie);
    expect(dto.status).toBe(200);
    expect(dto.body.data.parsedValues).toBeNull();
    const res = await request(app)
      .get(`/api/v1/documents/${id}/stored-values`)
      .set("Cookie", cookie);
    expect(res.body.data.reason).toBe("unreadable");
  });

  it("says nothing was found when the reading holds none of the values", async () => {
    const id = await kept("empty", {
      domain: "flight",
      parserUsed: "llm",
      flights: [{ flightNumber: "LH1", departureTime: "2026-05-01T08:00" }],
    });
    const res = await request(app)
      .get(`/api/v1/documents/${id}/stored-values`)
      .set("Cookie", cookie);
    expect(res.body.data).toMatchObject({ domain: "flight", values: null, reason: "nothingFound" });
  });

  it("is another account's document: 404, and a bad hint is a 400", async () => {
    const id = await kept("mine", TWO_LEGS);
    const foreign = await request(app)
      .get(`/api/v1/documents/${id}/stored-values`)
      .set("Cookie", strangerCookie);
    expect(foreign.status).toBe(404);
    const bad = await request(app)
      .get(`/api/v1/documents/${id}/stored-values?departureDate=tomorrow`)
      .set("Cookie", cookie);
    expect(bad.status).toBe(400);
  });
});

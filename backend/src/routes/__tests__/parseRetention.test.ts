import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const parseBookingEmail =
  jest.fn<
    (
      subject?: string,
      text?: string,
      html?: string,
      settings?: { referenceDate?: Date }
    ) => Promise<unknown>
  >();
const parseBookingText = jest.fn<(text: string, userId?: string) => Promise<unknown>>();
const extractTextFromPdf = jest.fn<(buffer: Buffer) => Promise<string>>();

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

import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * Parse routes and kept originals (forgejo#116, step 4).
 *
 * What is pinned: `retain` keeps exactly the input and records the parse on it;
 * `documentId` reads the kept bytes — including an .eml's own subject, HTML and
 * send date — and a retain that could not be kept is refused BEFORE the parser
 * runs, not after a minute of work.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);
const EML = [
  "From: bookings@airline.example",
  "Subject: Ihre Buchung LH1234",
  "Date: Sat, 16 Jul 2005 10:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Flug LH1234 am 16 JUL von FRA nach MUC",
].join("\r\n");

describe("parse routes keep their originals", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `parse-keep-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `parse-keep-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    parseBookingEmail.mockReset();
    parseBookingText.mockReset();
    extractTextFromPdf.mockReset();
    parseBookingEmail.mockResolvedValue({ flights: [], parserUsed: "regex" });
    parseBookingText.mockResolvedValue({ flights: [], parserUsed: "regex" });
    extractTextFromPdf.mockResolvedValue("Flug LH1234 am 16.07.2005 von FRA nach MUC");
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({
      where: { userId: { in: [userId, strangerId] } },
    });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("keeps a pasted mail as text and records what the parse made of it", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: `Flug LH1234 ${stamp}`, retain: true });

    expect(res.status).toBe(200);
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: res.body.documentId },
    });
    expect(document).toMatchObject({
      userId,
      format: "emailText",
      source: "parse",
      parsedDomain: "flight",
    });
    expect(document.parsedPayload).toMatchObject({ flights: [], parserUsed: "regex" });
    expect(fs.readFileSync(documentPath(document.storedName), "utf8")).toBe(`Flug LH1234 ${stamp}`);
  });

  it("answers without a documentId, and keeps nothing, when retain was not asked for", async () => {
    const before = await prisma.document.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: "x" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("documentId");
    expect(await prisma.document.count({ where: { userId } })).toBe(before);
  });

  it("refuses to keep a mail over the 2 MB limit before the parser runs", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: "a".repeat(2 * 1024 * 1024 + 1), retain: true });
    expect(res.status).toBe(413);
    expect(parseBookingEmail).not.toHaveBeenCalled();
  });

  it("reads a kept .eml by id with its own subject and send date, and records the parse on it", async () => {
    const { document } = await createDocument({
      userId,
      buffer: Buffer.from(`${EML}\r\n${stamp}`),
      originalName: "booking.eml",
    });

    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ documentId: document.id, domain: "flight" });

    expect(res.status).toBe(200);
    expect(res.body.documentId).toBe(document.id);
    const [subject, text, , settings] = parseBookingEmail.mock.calls[0] ?? [];
    expect(subject).toBe("Ihre Buchung LH1234");
    expect(text).toContain("Flug LH1234");
    expect(settings?.referenceDate?.toISOString().slice(0, 10)).toBe("2005-07-16");
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).parsedDomain
    ).toBe("flight");
  });

  it("answers 404 for another user's document and 415 for one the route cannot read", async () => {
    const foreign = await createDocument({ userId: strangerId, buffer: PDF(`foreign-${stamp}`) });
    const own = await createDocument({ userId, buffer: PDF(`own-${stamp}`) });

    const notYours = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ documentId: foreign.document.id });
    expect(notYours.status).toBe(404);

    const wrongRoute = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ documentId: own.document.id });
    expect(wrongRoute.status).toBe(415);
    expect(parseBookingEmail).not.toHaveBeenCalled();
  });

  it("wants exactly one of content and documentId", async () => {
    const own = await createDocument({ userId, buffer: PDF(`both-${stamp}`) });
    const both = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ pdfBase64: PDF("x").toString("base64"), documentId: own.document.id });
    expect(both.status).toBe(400);

    const neither = await request(app).post("/api/v1/parse-pdf").set("Cookie", cookie).send({});
    expect(neither.status).toBe(400);
  });

  it("keeps a PDF sent as base64, and a second retained parse of it is the same document", async () => {
    const pdf = PDF(`keep-${stamp}`).toString("base64");
    const send = () =>
      request(app)
        .post("/api/v1/parse-pdf")
        .set("Cookie", cookie)
        .send({ pdfBase64: pdf, retain: true });

    const first = await send();
    expect(first.status).toBe(200);
    const second = await send();
    expect(second.body.documentId).toBe(first.body.documentId);

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: first.body.documentId },
    });
    expect(document).toMatchObject({ format: "pdf", source: "parse" });
  });

  it("parses a kept PDF by id — the path for originals too large for a JSON body", async () => {
    const own = await createDocument({ userId, buffer: PDF(`by-id-${stamp}`) });
    const res = await request(app)
      .post("/api/v1/parse-pdf")
      .set("Cookie", cookie)
      .send({ documentId: own.document.id });
    expect(res.status).toBe(200);
    expect(res.body.documentId).toBe(own.document.id);
    expect(extractTextFromPdf.mock.calls[0]?.[0].equals(PDF(`by-id-${stamp}`))).toBe(true);
  });
});
